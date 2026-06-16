"use server";

import { createClient } from "@/lib/supabase/server";
import { sendMms } from "@/lib/solapi";

export type SmsActionResult = { ok: true } | { ok: false; error: string };

/**
 * 매출 거래명세서 이미지를 거래처에 MMS로 전송.
 * 이미지는 클라이언트(html2canvas)가 캡처한 data URL(JPEG base64) — 서버에서 버퍼로 변환.
 * 화면 갱신은 호출측 router.refresh() 로 처리(서버액션은 발송·기록만).
 */
export async function sendStatementSms(
  saleId: string,
  imageDataUrl: string,
  toPhone: string,
  siteName?: string,
  companyName?: string,
): Promise<SmsActionResult> {
  const base64 = imageDataUrl.split(",")[1] ?? "";
  if (!base64) return { ok: false, error: "명세서 이미지가 비어 있습니다." };

  const imageJpeg = Buffer.from(base64, "base64");
  const text = `[${companyName || "신라철강"}] ${siteName ? siteName + " " : ""}거래명세서를 보내드립니다.`;

  const r = await sendMms({ to: toPhone, text, subject: "거래명세서", imageJpeg });
  if (!r.ok) return { ok: false, error: r.error };

  // 전송 기록 — statement_sms_sent_on 컬럼이 있으면 기록(없어도 발송은 성공).
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  // 문자 전송 = 실제 '명세표 송부' → 라이프사이클 statement_sent_on 을 최초 1회 기록
  // (재전송이 날짜를 덮지 않도록 statement_sent_on 이 null 일 때만).
  await supabase
    .from("sale")
    .update({ statement_sent_on: today })
    .eq("id", saleId)
    .is("statement_sent_on", null);
  // 문자 전송일 별도 기록(best-effort — 컬럼 없어도 발송은 성공).
  await supabase.from("sale").update({ statement_sms_sent_on: today }).eq("id", saleId);

  return { ok: true };
}
