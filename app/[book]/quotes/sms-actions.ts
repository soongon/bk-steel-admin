"use server";

import { createClient } from "@/lib/supabase/server";
import { getMessageProvider } from "@/lib/message";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWorkWithImage } from "@/lib/kakaowork";

export type SmsActionResult = { ok: true } | { ok: false; error: string };

// MMS 이미지 권장 상한(솔라피 ~200KB) — 약간 여유. 초과 시 발송 전 차단(비용·413 방지).
const MAX_IMAGE_BYTES = 205_000; // 솔라피 MMS 상한 200KB — 클라 캡처가 195KB 이하로 압축(capture-node), 서버는 백스톱.

/**
 * 견적서 이미지를 거래처에 MMS로 전송. (sendStatementSms 미러)
 * 이미지는 클라이언트(html2canvas-pro)가 캡처한 data URL(JPEG base64) — 서버에서 버퍼로 변환.
 * 발송 성공 시 mms_sent_on 기록, draft 견적은 status='sent'·sent_on 으로 승격(won/sent 재전송은 mms_sent_on만).
 * 화면 갱신은 호출측 router.refresh().
 */
export async function sendQuoteMms(
  quoteId: string,
  imageDataUrl: string,
  toPhone: string,
  siteName?: string,
  companyName?: string,
): Promise<SmsActionResult> {
  const supabase = await createClient();

  // P0: 유료 발송 전 권한·존재 확인 — RLS 가 책별 권한(viewer)을 강제하고, 삭제건은 제외.
  const { data: quote, error: quoteErr } = await supabase
    .from("quote")
    .select("id, book, doc_no, partner:partner(name), prospect_name")
    .eq("id", quoteId)
    .is("deleted_at", null)
    .single();
  if (quoteErr || !quote) {
    return { ok: false, error: "권한이 없거나 존재하지 않는 견적입니다." };
  }

  // 이미지 검증: MIME prefix + 크기(MMS 상한). 발송 전에 막아 비용·413 방지.
  if (!imageDataUrl.startsWith("data:image/")) {
    return { ok: false, error: "이미지 형식이 올바르지 않습니다." };
  }
  const base64 = imageDataUrl.split(",")[1] ?? "";
  if (!base64) return { ok: false, error: "견적서 이미지가 비어 있습니다." };
  const imageJpeg = Buffer.from(base64, "base64");
  if (imageJpeg.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `이미지가 너무 큽니다(${Math.round(imageJpeg.byteLength / 1024)}KB). MMS 권장 200KB 이하로 줄여주세요.`,
    };
  }

  const company = await fetchCompanyProfile(supabase, quote.book as Book);
  const text = `[${companyName || "신라철강"}] ${siteName ? siteName + " " : ""}견적서를 보내드립니다.`;
  const r = await getMessageProvider().sendImageMms({
    corpNum: company?.business_no ?? null,
    to: toPhone,
    subject: "견적서",
    text,
    imageJpeg,
  });
  if (!r.ok) return { ok: false, error: r.error };

  // 발송 성공 → 기록(best-effort). KST 기준.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const { error: e1 } = await supabase.from("quote").update({ mms_sent_on: today }).eq("id", quoteId);
  // draft 견적만 sent 로 승격(+ sent_on). 이미 sent/won 인 건의 발송 상태는 보존.
  const { error: e2 } = await supabase
    .from("quote")
    .update({ status: "sent", sent_on: today })
    .eq("id", quoteId)
    .eq("status", "draft");
  if (e1 || e2) {
    console.error("[quote-sms] 발송 성공·기록 실패:", e1?.message ?? e2?.message, "quote=", quoteId);
  }

  // 견적서 이미지도 운영방(카카오워크)에 공유(best-effort)
  await notifyKakaoWorkWithImage(
    supabase,
    imageJpeg,
    `quote-${quoteId}`,
    `📄 견적서 송부 · ${BOOK_LABEL[quote.book as Book]}\n` +
      `거래처: ${(quote.partner as { name?: string } | null)?.name ?? quote.prospect_name ?? "—"} · 문서 ${quote.doc_no}\n` +
      `수신: ${toPhone}`,
  );
  return { ok: true };
}
