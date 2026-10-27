import "server-only";

import { sanitizeReading, type BizDocReading } from "@/lib/biz-doc";

/**
 * 사업자 서류 이미지 AI 인식 — Claude(Anthropic Messages API)가 계산서·사업자등록증 사진에서 사업자 정보를 읽는다.
 * env(서버 전용): ANTHROPIC_API_KEY. 미설정이면 인식 없이 이미지만 저장된다(거래처 칸은 직접 입력).
 * 결과는 JSON 스키마(structured outputs)로 받고, lib/biz-doc sanitizeReading 으로 다시 다듬는다(번호 형식·길이).
 */

const API_URL = "https://api.anthropic.com/v1/messages";
/** 작은 글씨(계산서 표)를 정확히 읽는 게 우선 — 가장 정확한 모델. 1장에 수 초~십여 초. */
const MODEL = "claude-opus-5-5";
/**
 * 이 모델은 생각(adaptive thinking)을 끌 수 없고 생각 토큰도 max_tokens 에 든다 — JSON(~600토큰)만 보고 작게 잡으면
 * 생각하다 잘려 결과가 비어 온다. 상한일 뿐이라 넉넉히 두고, 옮겨 적는 일이라 생각 깊이(effort)는 낮게.
 */
const MAX_TOKENS = 8000;
const EFFORT = "low";
/** 한 번 시도 상한. 서버 액션 상한(거래처 화면 maxDuration 60초) 안에서 한 번 더 시도할 여유를 둔다. */
const ATTEMPT_TIMEOUT_MS = 40_000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

export const bizDocOcrConfigured = () => !!process.env.ANTHROPIC_API_KEY?.trim();

export class BizDocOcrError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "failed",
  ) {
    super(message);
  }
}

const NULLABLE = { type: ["string", "null"] } as const;
const SCHEMA = {
  type: "object",
  properties: {
    doc_type: { type: "string", enum: ["tax_invoice", "invoice", "biz_registration", "business_card", "other"] },
    parties: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["supplier", "buyer", "holder"] },
          business_no: NULLABLE,
          name: NULLABLE,
          representative: NULLABLE,
          address: NULLABLE,
          business_type: NULLABLE,
          business_item: NULLABLE,
          email: NULLABLE,
          phone: NULLABLE,
        },
        required: ["role", "business_no", "name", "representative", "address", "business_type", "business_item", "email", "phone"],
        additionalProperties: false,
      },
    },
    note: NULLABLE,
  },
  required: ["doc_type", "parties", "note"],
  additionalProperties: false,
};

const PROMPT = `한국 사업자 서류 사진(또는 화면 캡처)에서 사업자 정보를 읽어 JSON 으로 돌려준다.

서류 종류(doc_type):
- tax_invoice: 세금계산서·전자세금계산서(공급가액과 세액 칸이 있다)
- invoice: 계산서(면세 — 세액 칸이 없다)
- biz_registration: 사업자등록증 또는 사업자등록증명
- business_card: 명함
- other: 그 밖의 서류(통장 사본·거래명세서 등)나 사업자 정보가 없는 이미지

사업자(parties):
- 세금계산서·계산서: 공급자(role "supplier" — 보통 왼쪽·빨간 칸)와 공급받는자(role "buyer" — 보통 오른쪽·파란 칸)를 각각 하나씩.
  등록번호 → business_no, 상호(법인명) → name, 성명(대표자) → representative, 사업장(주소) → address,
  업태 → business_type, 종목 → business_item, 이메일 → email.
- 사업자등록증: 사업자 하나(role "holder"). 등록번호 → business_no, 상호(법인명) → name, 대표자(성명) → representative,
  사업장 소재지 → address, 사업의 종류의 업태·종목 → business_type·business_item.
- 명함·기타 서류: 회사(사업자)가 보이면 하나(role "holder"). 회사 대표 전화 → phone.

규칙:
- 보이는 글자를 그대로 옮긴다((주)·주식회사 같은 표기 포함). 추측하거나 지어내지 않는다.
- 안 보이거나 흐려서 확실하지 않은 칸은 null.
- business_no 는 10자리 사업자등록번호만(예: 123-45-67890). 종사업장번호·법인등록번호(13자리)·주민등록번호는 넣지 않는다.
- 업태·종목이 여러 개면 쉼표로 이어 쓴다.
- note: 읽기 어려웠던 점(흐림·잘림·가려짐 등)을 한국어로 짧게. 없으면 null.`;

type ApiError = { error?: { type?: string; message?: string } };

function friendlyApiError(status: number, body: ApiError | null): string {
  const msg = body?.error?.message ?? "";
  if (status === 401) return "AI 인식 키(ANTHROPIC_API_KEY)가 올바르지 않습니다.";
  if (status === 403) return "AI 인식 키에 권한이 없습니다(Anthropic 콘솔 확인).";
  if (/credit balance/i.test(msg)) return "AI 인식 크레딧이 부족합니다 — Anthropic 콘솔에서 충전해 주세요.";
  if (status === 429) return "AI 인식 요청이 몰렸습니다 — 잠시 뒤 다시 올려 주세요.";
  if (status === 413) return "이미지가 너무 큽니다.";
  if (status >= 500) return "AI 인식 서버가 바쁩니다 — 잠시 뒤 다시 올려 주세요.";
  return `AI 인식 요청이 거부되었습니다(${status}${msg ? `: ${msg}` : ""}).`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 이미지 1장을 읽는다. 키가 없으면 BizDocOcrError(not_configured), 실패하면 BizDocOcrError(failed). */
export async function readBizDocImage(image: { data: ArrayBuffer; mediaType: string }): Promise<BizDocReading> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new BizDocOcrError("AI 인식이 설정되지 않았습니다(ANTHROPIC_API_KEY).", "not_configured");

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: Buffer.from(image.data).toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA } },
  });

  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new BizDocOcrError(timedOut ? "AI 인식이 너무 오래 걸립니다 — 다시 올려 주세요." : "AI 인식 서버에 연결하지 못했습니다.", "failed");
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as ApiError | null;
      // 빨리 실패한 일시 오류만 한 번 더(retry-after 존중, 최대 5초) — 오래 걸린 뒤의 실패는 서버 액션 상한을 넘길 수 있다.
      if (attempt === 0 && RETRY_STATUSES.has(res.status) && Date.now() - started < 15_000) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 5) * 1000 : 2000);
        continue;
      }
      throw new BizDocOcrError(friendlyApiError(res.status, err), "failed");
    }

    const json = (await res.json().catch(() => null)) as {
      stop_reason?: string;
      content?: Array<{ type?: string; text?: string }>;
    } | null;
    if (json?.stop_reason === "refusal") throw new BizDocOcrError("AI 가 이 이미지를 읽지 않았습니다.", "failed");
    // 생각(thinking) 블록 뒤의 text 블록이 JSON. 상한에 걸렸으면(생각 중 포함) 결과가 없거나 잘려 있다.
    if (json?.stop_reason === "max_tokens") throw new BizDocOcrError("AI 인식 결과가 잘렸습니다 — 다시 올려 주세요.", "failed");
    const out = json?.content?.find((b) => b.type === "text")?.text;
    if (!out) throw new BizDocOcrError("AI 인식 결과가 비어 있습니다.", "failed");
    try {
      return sanitizeReading(JSON.parse(out));
    } catch {
      throw new BizDocOcrError("AI 인식 결과를 해석하지 못했습니다.", "failed");
    }
  }
}
