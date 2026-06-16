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
  await supabase
    .from("sale")
    .update({ statement_sms_sent_on: new Date().toISOString().slice(0, 10) })
    .eq("id", saleId);

  return { ok: true };
}
