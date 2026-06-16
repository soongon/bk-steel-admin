import "server-only";
import { SolapiMessageService } from "solapi";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { digitsOnly } from "@/lib/format";

/**
 * 솔라피(CoolSMS) MMS 발송 래퍼 — 명세서 이미지를 거래처에 문자로 전송.
 *
 * env(.env.local · 서버 전용):
 *   SOLAPI_API_KEY      solapi.com → API Key
 *   SOLAPI_API_SECRET   solapi.com → API Secret
 *   SOLAPI_SENDER       발신번호(통신사 사전등록 필수) — 숫자만
 *
 * ⚠️ 골격: 키·발신번호 미설정 시 명확한 에러 반환(발송 안 함).
 *   발신번호 통신사 등록 + 키 발급 후 .env.local 에 채우면 바로 동작.
 */
function getService(): SolapiMessageService {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("SOLAPI_API_KEY / SOLAPI_API_SECRET 미설정");
  }
  return new SolapiMessageService(apiKey, apiSecret);
}

export type MmsResult = { ok: true; groupId?: string } | { ok: false; error: string };

/**
 * JPEG 이미지를 첨부해 MMS 1건 발송.
 * solapi 의 uploadFile 은 파일 경로 기반이라 임시파일로 저장 후 업로드한다.
 */
export async function sendMms(params: {
  to: string; // 수신 번호(하이픈/공백 허용 — 내부에서 숫자만 추출)
  text: string; // 본문 (MMS 최대 2,000byte)
  subject?: string; // MMS 제목
  imageJpeg: Buffer; // 명세서 JPEG 바이트
}): Promise<MmsResult> {
  const sender = process.env.SOLAPI_SENDER;
  if (!sender) {
    return { ok: false, error: "SOLAPI_SENDER(발신번호) 미설정 — 통신사 사전등록 후 .env 에 추가하세요." };
  }
  const to = digitsOnly(params.to);
  if (to.length < 10) {
    return { ok: false, error: "수신 전화번호가 올바르지 않습니다." };
  }

  let svc: SolapiMessageService;
  try {
    svc = getService();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "솔라피 초기화 실패" };
  }

  // randomUUID 로 임시파일명 충돌 방지(동일 ms·동일 번호 동시 발송 대비). Node runtime 전용(fs/os/path).
  const tmp = join(tmpdir(), `statement-${randomUUID()}.jpg`);
  try {
    await writeFile(tmp, params.imageJpeg);
    const uploaded = await svc.uploadFile(tmp, "MMS");
    const res = await svc.send({
      to,
      from: digitsOnly(sender),
      text: params.text,
      subject: params.subject,
      imageId: uploaded.fileId,
      type: "MMS",
    });
    // 그룹 정보(있으면) 반환 — 발송 추적용
    const groupId =
      (res as { groupInfo?: { _id?: string }; groupId?: string })?.groupInfo?._id ??
      (res as { groupId?: string })?.groupId;
    return { ok: true, groupId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "MMS 발송 실패" };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/** 잔액·포인트 조회(모니터링). 키 미설정/에러 시 null. */
export async function getSolapiBalance(): Promise<{ balance: number; point: number } | null> {
  try {
    const svc = getService();
    const b = (await svc.getBalance()) as { balance?: number | string; point?: number | string };
    return { balance: Number(b.balance ?? 0), point: Number(b.point ?? 0) };
  } catch {
    return null;
  }
}

export type SolapiMessage = {
  type: string;
  status: string;
  statusCode: string;
  reason: string;
  from: string;
  to: string;
  dateCreated: string;
};

/** 최근 발송 내역 조회(모니터링). 키 미설정/에러 시 []. */
export async function getSolapiMessages(limit = 50): Promise<SolapiMessage[]> {
  try {
    const svc = getService();
    const r = (await svc.getMessages({ limit })) as {
      messageList?: Record<string, Record<string, unknown>>;
    };
    const list = r.messageList ?? {};
    return Object.values(list).map((m) => ({
      type: String(m.type ?? ""),
      status: String(m.status ?? ""),
      statusCode: String(m.statusCode ?? ""),
      reason: String(m.reason ?? ""),
      from: String(m.from ?? ""),
      // to 는 SDK 상 문자열 또는 배열 → 배열이면 첫 번호만(표시용)
      to: Array.isArray(m.to) ? String(m.to[0] ?? "") : String(m.to ?? ""),
      dateCreated: String(m.dateCreated ?? ""),
    }));
  } catch {
    return [];
  }
}
