"use server";

import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWorkWithImage } from "@/lib/kakaowork";
import { kstToday, type MailActionResult, mailRecipientLine, mailSuccess, sendDocumentMail } from "@/lib/mail/document";

/**
 * 거래명세표를 메일로 — 모달의 명세표 DOM 캡처(JPEG)를 서버에서 PDF 로 감싸 회사 메일 계정(SMTP)으로 보낸다.
 * 성공하면 명세표 송부일(statement_sent_on)을 처음 한 번만 기록하고 운영방(카카오워크)에 공유한다(문자와 같은 규칙).
 */
export async function sendStatementMail(saleId: string, imageDataUrl: string, to: string, note?: string): Promise<MailActionResult> {
  const supabase = await createClient();
  const { data: sale, error } = await supabase
    .from("sale")
    .select("id, book, doc_no, site_name, partner:partner(name)")
    .eq("id", saleId)
    .is("deleted_at", null)
    .single();
  if (error || !sale) return { ok: false, error: "권한이 없거나 존재하지 않는 매출입니다." };

  const book = sale.book as Book;
  const site = (sale.site_name as string | null)?.trim();
  const r = await sendDocumentMail(supabase, {
    book,
    docLabel: "거래명세서",
    title: `${sale.doc_no}${site ? ` (${site})` : ""}`,
    imageDataUrl,
    toInput: to,
    note,
  });
  if (!r.ok) return r;

  // 송부일 — 최초 1회만(재전송해도 덮지 않음). 기록 실패는 발송 성공을 뒤집지 않는다.
  const { error: e1 } = await supabase
    .from("sale")
    .update({ statement_sent_on: kstToday() })
    .eq("id", saleId)
    .is("statement_sent_on", null);
  if (e1) console.error("[mail] 발송 성공·기록 실패:", e1.message, "sale=", saleId);

  const partnerName = (sale.partner as { name?: string } | null)?.name ?? "—";
  await notifyKakaoWorkWithImage(
    supabase,
    r.jpeg,
    `statement-mail-${saleId}`,
    `📧 명세표 메일 송부 · ${BOOK_LABEL[book]}\n거래처: ${partnerName} · 문서 ${sale.doc_no}\n${mailRecipientLine(r)}`,
  );
  return mailSuccess(r);
}
