"use server";

import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWorkWithImage } from "@/lib/kakaowork";
import { kstToday, type MailActionResult, mailRecipientLine, mailSuccess, sendDocumentMail } from "@/lib/mail/document";

/**
 * 매입견적서를 메일로 — 문서 캡처(JPEG)를 서버에서 PDF 로 감싸 회사 메일 계정(SMTP)으로 보낸다.
 * 매입 상대(판매자)는 먼저 팔겠다고 연락한 쪽이라 레이더 동의 검사는 두지 않는다(받는 번호 검사는 전화 기준이라 메일엔 해당 없음).
 * 본문에 '총중량·금액은 계근 후 확정'을 넣고, 성공하면 draft 만 sent·sent_on 으로 올린다(문자와 같은 규칙).
 */
export async function sendPurchaseQuoteMail(
  quoteId: string,
  imageDataUrl: string,
  to: string,
  note?: string,
): Promise<MailActionResult> {
  const supabase = await createClient();
  const { data: quote, error } = await supabase
    .from("purchase_quote")
    .select("id, book, doc_no, site_name, partner:partner(name), prospect_name")
    .eq("id", quoteId)
    .is("deleted_at", null)
    .single();
  if (error || !quote) return { ok: false, error: "권한이 없거나 존재하지 않는 매입견적입니다." };

  const book = quote.book as Book;
  const site = (quote.site_name as string | null)?.trim();
  const r = await sendDocumentMail(supabase, {
    book,
    docLabel: "매입견적서",
    title: `${quote.doc_no}${site ? ` (${site})` : ""}`,
    imageDataUrl,
    toInput: to,
    note: ["총중량·금액은 당일 계근 후 확정됩니다.", note?.trim() || null].filter(Boolean).join("\n"),
  });
  if (!r.ok) return r;

  const { error: e1 } = await supabase
    .from("purchase_quote")
    .update({ status: "sent", sent_on: kstToday() })
    .eq("id", quoteId)
    .eq("status", "draft");
  if (e1) console.error("[purchase-quote-mail] 발송 성공·기록 실패:", e1.message, "quote=", quoteId);

  const name = (quote.partner as { name?: string } | null)?.name ?? (quote.prospect_name as string | null) ?? "—";
  await notifyKakaoWorkWithImage(
    supabase,
    r.jpeg,
    `pquote-mail-${quoteId}`,
    `📧 매입견적서 메일 송부 · ${BOOK_LABEL[book]}\n판매자: ${name} · 문서 ${quote.doc_no}\n${mailRecipientLine(r)}`,
  );
  return mailSuccess(r);
}
