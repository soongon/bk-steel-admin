"use server";

import { createClient } from "@/lib/supabase/server";
import { getMessageProvider } from "@/lib/message";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWorkWithImage } from "@/lib/kakaowork";
import { digitsOnly, formatPhone } from "@/lib/format";
import { phoneKey } from "@/lib/radar/nara-rules";
import { recipientPhoneConsent } from "@/lib/radar/radar-data";

export type SmsActionResult = { ok: true } | { ok: false; error: string };

const MAX_IMAGE_BYTES = 205_000; // 솔라피 MMS 상한 200KB — 클라 캡처가 195KB 이하로 압축, 서버는 백스톱.

/**
 * 매입견적서 이미지를 판매자에게 MMS 로 전송 (sendQuoteMms 미러).
 * 문자 가드: 매입견적 상대는 보통 "먼저 팔겠다고 연락한 쪽"이라 매출 영업용 '견적 요청' 기록을 요구하지 않는다.
 *   다만 받는 번호가 발주 레이더가 보여준 번호(낙찰사 전화 등)면 그 행·계정 기준 동의(recipientPhoneConsent)를 그대로 적용하고,
 *   거래처에 매입·매출 이력이 있으면(거래관계) 통과.
 * 발송 성공 시 mms_sent_on 기록, draft 는 sent 로 승격.
 */
export async function sendPurchaseQuoteMms(
  quoteId: string,
  imageDataUrl: string,
  toPhone: string,
  siteName?: string,
  companyName?: string,
): Promise<SmsActionResult> {
  const supabase = await createClient();

  const { data: quote, error: quoteErr } = await supabase
    .from("purchase_quote")
    .select("id, book, doc_no, partner_id, partner:partner(name), prospect_name")
    .eq("id", quoteId)
    .is("deleted_at", null)
    .single();
  if (quoteErr || !quote) return { ok: false, error: "권한이 없거나 존재하지 않는 매입견적입니다." };

  const to = phoneKey(digitsOnly(toPhone));
  if (!to) return { ok: false, error: "수신 전화번호가 올바르지 않습니다 — 국내 번호 하나만 입력하세요." };

  // 받는 번호 기준 동의 검사는 거래관계와 무관하게 항상 — 레이더가 보여준 번호(낙찰사 전화 등)면 그 행·계정의
  // '견적 요청' 기록이 있어야 하고 거절(수신거부)은 차단(매출 견적 가드와 동일). 매입 상대는 보통 먼저 팔겠다고 연락한 쪽이라
  // 매출 가드의 '거래처·출처 기준' 검사(quoteSideConsent)는 요구하지 않는다.
  const consent = await recipientPhoneConsent(supabase, to);
  if (!consent.ok) return { ok: false, error: consent.reason };

  if (!imageDataUrl.startsWith("data:image/")) return { ok: false, error: "이미지 형식이 올바르지 않습니다." };
  const base64 = imageDataUrl.split(",")[1] ?? "";
  if (!base64) return { ok: false, error: "매입견적서 이미지가 비어 있습니다." };
  const imageJpeg = Buffer.from(base64, "base64");
  if (imageJpeg.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: `이미지가 너무 큽니다(${Math.round(imageJpeg.byteLength / 1024)}KB). MMS 권장 200KB 이하로 줄여주세요.` };
  }

  const company = await fetchCompanyProfile(supabase, quote.book as Book);
  const site = (siteName ?? "").trim().slice(0, 40);
  const corp = (companyName || company?.name || "신라철강").trim().slice(0, 30);
  const text = `[${corp}] ${site ? site + " " : ""}매입 단가 견적서를 보내드립니다. 총중량·금액은 당일 계근 후 확정됩니다.`;
  const r = await getMessageProvider().sendImageMms({
    corpNum: company?.business_no ?? null,
    to,
    subject: "매입견적서",
    text,
    imageJpeg,
  });
  if (!r.ok) return { ok: false, error: r.error };

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const { error: e1 } = await supabase.from("purchase_quote").update({ mms_sent_on: today }).eq("id", quoteId);
  const { error: e2 } = await supabase
    .from("purchase_quote")
    .update({ status: "sent", sent_on: today })
    .eq("id", quoteId)
    .eq("status", "draft");
  if (e1 || e2) console.error("[purchase-quote-sms] 발송 성공·기록 실패:", e1?.message ?? e2?.message, "quote=", quoteId);

  await notifyKakaoWorkWithImage(
    supabase,
    imageJpeg,
    `pquote-${quoteId}`,
    `📄 매입견적서 송부 · ${BOOK_LABEL[quote.book as Book]}\n` +
      `판매자: ${(quote.partner as { name?: string } | null)?.name ?? quote.prospect_name ?? "—"} · 문서 ${quote.doc_no}\n` +
      `수신: ${formatPhone(to)}`,
  );
  return { ok: true };
}
