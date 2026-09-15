"use server";

import { createClient } from "@/lib/supabase/server";
import { getMessageProvider } from "@/lib/message";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { type Book } from "@/lib/book";
import { notifyKakaoWorkWithImage } from "@/lib/kakaowork";

export type SmsActionResult = { ok: true } | { ok: false; error: string };

// MMS 이미지 권장 상한(솔라피 ~200KB) — sales/[id]/sms-actions 와 동일 백스톱.
const MAX_IMAGE_BYTES = 205_000;

/**
 * 현장 누적 거래명세서 이미지를 거래처에 MMS 전송 — sendStatementSms 미러.
 * 누적(여러 매출)이라 개별 sale 의 송부일은 건드리지 않는다(발송만).
 * book = 공급자(발신 사업자번호) 책 — 페이지의 supplierBook 그대로.
 */
export async function sendSiteStatementSms(
  siteId: string,
  book: Book,
  imageDataUrl: string,
  toPhone: string,
  companyName?: string,
): Promise<SmsActionResult> {
  const supabase = await createClient();

  // 유료 발송 전 권한·존재 확인 — RLS 경유(로그인 필요), 삭제 현장 제외.
  const { data: site, error: siteErr } = await supabase
    .from("site")
    .select("id, name")
    .eq("id", siteId)
    .is("deleted_at", null)
    .single();
  if (siteErr || !site) {
    return { ok: false, error: "권한이 없거나 존재하지 않는 현장입니다." };
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    return { ok: false, error: "이미지 형식이 올바르지 않습니다." };
  }
  const base64 = imageDataUrl.split(",")[1] ?? "";
  if (!base64) return { ok: false, error: "명세서 이미지가 비어 있습니다." };
  const imageJpeg = Buffer.from(base64, "base64");
  if (imageJpeg.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `이미지가 너무 큽니다(${Math.round(imageJpeg.byteLength / 1024)}KB). MMS 권장 200KB 이하로 줄여주세요.`,
    };
  }

  const company = await fetchCompanyProfile(supabase, book);
  const text = `[${companyName || company?.name || "신라철강"}] ${site.name} 거래명세서를 보내드립니다.`;
  const r = await getMessageProvider().sendImageMms({
    corpNum: company?.business_no ?? null,
    to: toPhone,
    subject: "거래명세서",
    text,
    imageJpeg,
  });
  if (!r.ok) return { ok: false, error: r.error };

  // 운영방(카카오워크) 공유 — best-effort
  await notifyKakaoWorkWithImage(
    supabase,
    imageJpeg,
    `site-statement-${siteId}`,
    `📄 현장 누적 명세표 송부\n현장: ${site.name}\n수신: ${toPhone}`,
  );
  return { ok: true };
}
