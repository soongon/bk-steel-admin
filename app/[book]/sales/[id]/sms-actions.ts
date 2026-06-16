"use server";

import { createClient } from "@/lib/supabase/server";
import { sendMms } from "@/lib/solapi";

export type SmsActionResult = { ok: true } | { ok: false; error: string };

// MMS 이미지 권장 상한(솔라피 ~200KB) — 약간 여유. 초과 시 발송 전 차단(비용·413 방지).
const MAX_IMAGE_BYTES = 280_000;

/**
 * 매출 거래명세서 이미지를 거래처에 MMS로 전송.
 * 이미지는 클라이언트(html2canvas-pro)가 캡처한 data URL(JPEG base64) — 서버에서 버퍼로 변환.
 * 화면 갱신은 호출측 router.refresh().
 */
export async function sendStatementSms(
  saleId: string,
  imageDataUrl: string,
  toPhone: string,
  siteName?: string,
  companyName?: string,
): Promise<SmsActionResult> {
  const supabase = await createClient();

  // P0: 유료 발송 전 권한·존재 확인 — RLS 가 책별 권한(viewer)을 강제하고, 삭제건은 제외.
  // 권한 없거나 없는 매출이면 0건 → single() error.
  const { data: sale, error: saleErr } = await supabase
    .from("sale")
    .select("id")
    .eq("id", saleId)
    .is("deleted_at", null)
    .single();
  if (saleErr || !sale) {
    return { ok: false, error: "권한이 없거나 존재하지 않는 매출입니다." };
  }

  // 이미지 검증: MIME prefix + 크기(MMS 상한). 발송 전에 막아 비용·413 방지.
  if (!imageDataUrl.startsWith("data:image/")) {
    return { ok: false, error: "이미지 형식이 올바르지 않습니다." };
  }
  const base64 = imageDataUrl.split(",")[1] ?? "";
  if (!base64) return { ok: false, error: "명세서 이미지가 비어 있습니다." };
  const imageJpeg = Buffer.from(base64, "base64");
  if (imageJpeg.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `이미지가 너무 큽니다(${Math.round(imageJpeg.byteLength / 1024)}KB). MMS 권장 200KB 이하로 줄여주세요.`,
    };
  }

  const text = `[${companyName || "신라철강"}] ${siteName ? siteName + " " : ""}거래명세서를 보내드립니다.`;
  const r = await sendMms({ to: toPhone, text, subject: "거래명세서", imageJpeg });
  if (!r.ok) return { ok: false, error: r.error };

  // 문자 전송 = 명세표 송부 → statement_sent_on 최초 1회 기록(재전송이 날짜 안 덮게).
  // 발송은 이미 성공했으므로 기록 실패는 로그만 남기고 성공 반환(best-effort).
  const today = new Date().toISOString().slice(0, 10);
  const { error: e1 } = await supabase
    .from("sale")
    .update({ statement_sent_on: today })
    .eq("id", saleId)
    .is("statement_sent_on", null);
  const { error: e2 } = await supabase
    .from("sale")
    .update({ statement_sms_sent_on: today })
    .eq("id", saleId);
  if (e1 || e2) {
    console.error("[sms] 발송 성공·기록 실패:", e1?.message ?? e2?.message, "sale=", saleId);
  }

  return { ok: true };
}
