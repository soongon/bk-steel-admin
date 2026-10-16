"use server";

import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL, isValidBook } from "@/lib/book";
import { notifyKakaoWorkWithImage } from "@/lib/kakaowork";
import { type MailActionResult, mailRecipientLine, mailSuccess, sendDocumentMail } from "@/lib/mail/document";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 현장 누적 명세서를 메일로. 공급자 책은 화면과 같은 규칙으로 서버가 다시 정한다:
 * 그룹(?partner=&book=)이면 그 책, 책 경로면 그 책, 전체(all)면 그 현장 매출의 책이 하나일 때만 — 섞이면 거부.
 * 누적본은 여러 매출에 걸쳐 있어 개별 매출 송부일은 건드리지 않는다(문자와 같음).
 */
export async function sendSiteStatementMail(input: {
  siteId: string;
  viewBook: string;
  groupBook?: string | null;
  partnerId?: string | null;
  imageDataUrl: string;
  to: string;
  note?: string;
}): Promise<MailActionResult> {
  if (!UUID_RE.test(input.siteId)) return { ok: false, error: "현장이 올바르지 않습니다." };
  const groupMode = !!input.partnerId && !!input.groupBook;
  if (groupMode && (!UUID_RE.test(input.partnerId!) || !isValidBook(input.groupBook))) {
    return { ok: false, error: "거래처·책 정보가 올바르지 않습니다." };
  }

  const supabase = await createClient();
  const { data: site, error: siteErr } = await supabase
    .from("site")
    .select("id, code, name")
    .eq("id", input.siteId)
    .is("deleted_at", null)
    .single();
  if (siteErr || !site) return { ok: false, error: "권한이 없거나 존재하지 않는 현장입니다." };

  // 화면(page.tsx)과 같은 범위의 매출 — RLS 가 책 권한을 강제한다.
  let q = supabase.from("sale").select("book, ordered_on").eq("site_id", input.siteId).is("deleted_at", null);
  if (groupMode) q = q.eq("book", input.groupBook!).eq("partner_id", input.partnerId!);
  else if (isValidBook(input.viewBook)) q = q.eq("book", input.viewBook);
  const { data: sales, error: saleErr } = await q;
  if (saleErr) return { ok: false, error: `매출 조회 실패: ${saleErr.message}` };
  if (!sales || sales.length === 0) return { ok: false, error: "권한이 없거나 매출이 없는 현장입니다." };
  const books = [...new Set(sales.map((s) => s.book as Book))];
  if (books.length !== 1) {
    return { ok: false, error: "여러 책이 섞인 누적 명세서는 메일로 보낼 수 없습니다 — 책별로 열어서 보내세요." };
  }
  const book = books[0];
  const dates = sales.map((s) => s.ordered_on as string).sort();
  const period = dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`;

  const r = await sendDocumentMail(supabase, {
    book,
    docLabel: "거래명세서",
    title: `${site.name} 누적 (${period})`,
    imageDataUrl: input.imageDataUrl,
    toInput: input.to,
    note: input.note,
  });
  if (!r.ok) return r;

  await notifyKakaoWorkWithImage(
    supabase,
    r.jpeg,
    `site-statement-mail-${input.siteId}`,
    `📧 현장 누적 명세표 메일 송부 · ${BOOK_LABEL[book]}\n현장: ${site.name} (${period})\n${mailRecipientLine(r)}`,
  );
  return mailSuccess(r);
}
