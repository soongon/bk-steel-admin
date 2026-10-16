"use server";

import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWorkWithImage } from "@/lib/kakaowork";
import { quoteMmsConsent } from "@/lib/radar/radar-data";
import { kstToday, type MailActionResult, mailRecipientLine, mailSuccess, sendDocumentMail } from "@/lib/mail/document";

/**
 * 견적서를 메일로 — 모달의 견적서 DOM 캡처(JPEG)를 서버에서 PDF 로 감싸 회사 메일 계정(SMTP)으로 보낸다.
 * 발주 레이더에서 나온 상대는 문자와 같은 동의 원칙(정보통신망법 §50 취지): 견적·거래처 기준 검사만 —
 * 메일 주소로 대조할 레이더 데이터는 없다. 성공하면 draft 견적만 sent·sent_on 으로 올린다(문자와 같은 규칙).
 */
export async function sendQuoteMail(quoteId: string, imageDataUrl: string, to: string, note?: string): Promise<MailActionResult> {
  const supabase = await createClient();
  const { data: quote, error } = await supabase
    .from("quote")
    .select("id, book, doc_no, site_name, partner_id, partner:partner(name), prospect_name, source_project_id")
    .eq("id", quoteId)
    .is("deleted_at", null)
    .single();
  if (error || !quote) return { ok: false, error: "권한이 없거나 존재하지 않는 견적입니다." };

  const consent = await quoteMmsConsent(supabase, {
    sourceProjectId: (quote.source_project_id as string | null) ?? null,
    partnerId: (quote.partner_id as string | null) ?? null,
  });
  if (!consent.ok) return { ok: false, error: consent.reason.replace(/문자를/g, "메일을").replace(/문자/g, "메일") };

  const book = quote.book as Book;
  const site = (quote.site_name as string | null)?.trim();
  const r = await sendDocumentMail(supabase, {
    book,
    docLabel: "견적서",
    title: `${quote.doc_no}${site ? ` (${site})` : ""}`,
    imageDataUrl,
    toInput: to,
    note,
  });
  if (!r.ok) return r;

  // draft 만 sent 로(+ sent_on). 이미 sent/won 인 견적의 상태는 보존. 기록 실패는 발송 성공을 뒤집지 않는다.
  const { error: e1 } = await supabase
    .from("quote")
    .update({ status: "sent", sent_on: kstToday() })
    .eq("id", quoteId)
    .eq("status", "draft");
  if (e1) console.error("[quote-mail] 발송 성공·기록 실패:", e1.message, "quote=", quoteId);

  const name = (quote.partner as { name?: string } | null)?.name ?? (quote.prospect_name as string | null) ?? "—";
  await notifyKakaoWorkWithImage(
    supabase,
    r.jpeg,
    `quote-mail-${quoteId}`,
    `📧 견적서 메일 송부 · ${BOOK_LABEL[book]}\n거래처: ${name} · 문서 ${quote.doc_no}\n${mailRecipientLine(r)}`,
  );
  return mailSuccess(r);
}
