import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Book } from "@/lib/book";
import { type CompanyProfile, fetchCompanyProfile } from "@/lib/company-profile";
import { formatPhone } from "@/lib/format";
import { jpegToPdf } from "@/lib/jpeg-pdf";
import { MAIL_IMAGE_MAX_BYTES, type MailStatus, mailToError, parseEmails } from "./address";
import { composeDocumentMail, isMailConfigured, sendMail } from "./index";

// 문서 메일 공통 처리 — 각 문서의 mail-actions.ts 가 권한·대상 확인 뒤 부르고, 성공하면 각자 기록·알림을 붙인다.

/** warning: 일부 주소만 거부됐을 때(나머지에는 발송됨) 화면에 띄울 안내. */
export type MailActionResult = { ok: true; warning?: string } | { ok: false; error: string };

const B_BOOK_ERROR = "B계좌 문서는 메일로 보내지 않습니다(회사 메일함에 기록이 남음) — 필요하면 문자로 보내세요.";

/** 화면 버튼 상태. book=null 은 책이 섞인 누적 명세서. */
export function mailStatusFor(book: Book | null, company: CompanyProfile | null): MailStatus {
  if (book === null) return "mixed-books";
  if (book === "b") return "b-book";
  if (!company?.name) return "no-company";
  return isMailConfigured() ? "ready" : "unconfigured";
}

export const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

/**
 * 문서 이미지(JPEG data URL) → PDF 첨부 메일. 검사: B계좌 금지·받는 주소·이미지 형식/크기·직원 권한·회사 정보.
 * 보내는 이름은 서버에서 읽은 그 책의 회사명(클라이언트 값은 쓰지 않음).
 * 성공하면 받은 주소와 JPEG(운영방 공유용)를 돌려준다.
 */
export async function sendDocumentMail(
  supabase: SupabaseClient,
  p: { book: Book; docLabel: string; title: string | null; imageDataUrl: string; toInput: string; note?: string | null },
): Promise<{ ok: true; to: string[]; rejected: string[]; jpeg: Buffer; company: CompanyProfile } | { ok: false; error: string }> {
  if (p.book === "b") return { ok: false, error: B_BOOK_ERROR };
  const parsed = parseEmails(p.toInput);
  const toErr = mailToError(parsed);
  if (toErr) return { ok: false, error: toErr };

  const prefix = "data:image/jpeg;base64,";
  if (typeof p.imageDataUrl !== "string" || !p.imageDataUrl.startsWith(prefix)) {
    return { ok: false, error: "문서 이미지 형식이 올바르지 않습니다." };
  }
  const jpeg = Buffer.from(p.imageDataUrl.slice(prefix.length), "base64");
  if (jpeg.byteLength === 0) return { ok: false, error: "문서 이미지가 비어 있습니다." };
  if (jpeg.byteLength > MAIL_IMAGE_MAX_BYTES) {
    return { ok: false, error: `문서 이미지가 너무 큽니다(${(jpeg.byteLength / 1_048_576).toFixed(1)}MB).` };
  }

  // 보내기는 그 책의 직원(staff) 이상 — 조회 권한(viewer)만으로는 회사 명의 메일을 못 보낸다.
  const { data: canSend, error: roleErr } = await supabase.rpc("current_user_has_book_role", { p_book: p.book, p_min_role: "staff" });
  if (roleErr) return { ok: false, error: `권한 확인 실패: ${roleErr.message}` };
  if (!canSend) return { ok: false, error: "메일 전송 권한이 없습니다(이 책의 직원 이상)." };

  const company = await fetchCompanyProfile(supabase, p.book);
  if (!company?.name) return { ok: false, error: "회사 정보가 없습니다 — 설정 > 회사 정보를 먼저 채우세요." };

  let pdf: Buffer;
  try {
    pdf = jpegToPdf(jpeg, { title: [p.docLabel, p.title].filter(Boolean).join(" ") });
  } catch (e) {
    return { ok: false, error: `PDF를 만들지 못했습니다${e instanceof Error ? ` (${e.message})` : ""}.` };
  }
  const m = composeDocumentMail({
    docLabel: p.docLabel,
    title: p.title,
    companyName: company.name,
    companyPhone: formatPhone(company.phone) || formatPhone(company.mobile) || null,
    note: p.note,
    pdf,
    previewJpeg: jpeg,
  });
  const r = await sendMail({ fromName: company.name, to: parsed.emails, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
  if (!r.ok) return r;
  const rejectedKeys = new Set(r.rejected.map((a) => a.toLowerCase()));
  const to = parsed.emails.filter((a) => !rejectedKeys.has(a.toLowerCase()));
  return { ok: true, to, rejected: r.rejected, jpeg, company };
}

/** 운영방(카카오워크) '수신' 줄 — 받은 주소 + 거부된 주소. */
export const mailRecipientLine = (r: { to: string[]; rejected: string[] }) =>
  `수신: ${r.to.join(", ")}${r.rejected.length > 0 ? `\n거부: ${r.rejected.join(", ")}` : ""}`;

/** 액션 성공 결과 — 일부 주소가 거부됐으면 안내를 붙인다. */
export const mailSuccess = (r: { rejected: string[] }): MailActionResult =>
  r.rejected.length > 0 ? { ok: true, warning: `일부 주소를 메일 서버가 거부했습니다: ${r.rejected.join(", ")}` } : { ok: true };
