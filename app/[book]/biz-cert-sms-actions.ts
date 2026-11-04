"use server";

import { createClient } from "@/lib/supabase/server";
import { getMessageProvider } from "@/lib/message";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { digitsOnly } from "@/lib/format";
import { notifyKakaoWork } from "@/lib/kakaowork";

export type BizCertSmsResult = { ok: true } | { ok: false; error: string };

const MAX_IMAGE_BYTES = 205_000; // 솔라피 MMS 상한 200KB — 클라가 195KB 이하로 줄여 보내고, 서버는 백스톱
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 우리 사업자등록증(책별 company_profile.biz_cert_url)을 거래처에 MMS 로 보낸다 — 매출·매입 상세 머리 [사업자등록증].
 * 거래처가 계산서 발행·거래처 등록용으로 요청할 때. 이미지는 클라이언트가 공개 URL 을 읽어 200KB 이하 JPEG 로 줄인 data URL.
 * 유료 발송 전 그 거래가 보이는지(RLS)와 그 책 staff 이상인지(메일 발송과 같은 기준 — viewer 는 못 보냄), 등록증이 있는지 확인한다.
 * 거래 행엔 아무것도 기록하지 않는다.
 */
export async function sendBizCertSms(
  parent: "sale" | "purchase",
  id: string,
  imageDataUrl: string,
  toPhone: string,
): Promise<BizCertSmsResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "잘못된 거래입니다." };
  const to = digitsOnly(toPhone);
  if (to.length < 10 || to.length > 11) return { ok: false, error: "수신 번호를 확인하세요." };

  const supabase = await createClient();
  const { data: trade, error } = await supabase
    .from(parent)
    .select("id, book, doc_no, partner:partner(name)")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !trade) return { ok: false, error: `권한이 없거나 존재하지 않는 ${parent === "sale" ? "매출" : "매입"}입니다.` };

  // 책은 클라이언트 값이 아니라 거래 행의 것으로 — 유료 발송은 그 책 staff 이상만.
  const { data: canSend, error: roleErr } = await supabase.rpc("current_user_has_book_role", { p_book: trade.book, p_min_role: "staff" });
  if (roleErr) return { ok: false, error: `권한 확인 실패: ${roleErr.message}` };
  if (!canSend) return { ok: false, error: "문자 전송 권한이 없습니다 (이 책 staff 이상 필요)." };

  const company = await fetchCompanyProfile(supabase, trade.book as Book);
  if (!company?.biz_cert_url) return { ok: false, error: "등록된 사업자등록증이 없습니다 — 설정 > 회사 정보에서 올려 주세요." };

  if (!imageDataUrl.startsWith("data:image/")) return { ok: false, error: "이미지 형식이 올바르지 않습니다." };
  const base64 = imageDataUrl.split(",")[1] ?? "";
  if (!base64) return { ok: false, error: "사업자등록증 이미지가 비어 있습니다." };
  const imageJpeg = Buffer.from(base64, "base64");
  if (imageJpeg.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: `이미지가 너무 큽니다(${Math.round(imageJpeg.byteLength / 1024)}KB). MMS 상한 200KB 이하여야 합니다.` };
  }

  const r = await getMessageProvider().sendImageMms({
    corpNum: company.business_no ?? null,
    to,
    subject: "사업자등록증",
    text: `[${company.name}] 사업자등록증을 보내드립니다.`,
    imageJpeg,
  });
  if (!r.ok) return { ok: false, error: r.error };

  // 운영방 알림(best-effort) — 이미지는 안 보낸다(등록증은 운영방에 둘 필요 없음)
  await notifyKakaoWork(
    `📄 사업자등록증 문자 전송 · ${BOOK_LABEL[trade.book as Book]}\n` +
      `거래처: ${(trade.partner as { name?: string } | null)?.name ?? "—"} · 문서 ${trade.doc_no}\n` +
      `수신: ${to}`,
  );
  return { ok: true };
}
