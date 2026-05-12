"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";

export type IssueCertResult =
  | { ok: true; cert_id: string; doc_no: string; already_existed: boolean }
  | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("row-level security")) return "권한이 없습니다 (staff 이상 필요).";
  if (message.includes("uq_delivery_cert_partner_site"))
    return "이미 동일 거래처·현장에 납품확인서가 발급되었습니다.";
  return message;
}

/**
 * 현장(site_id) + 거래처(partner_id) + 책(book) 단위로 납품확인서 발급.
 * 매출 단건 기반(sales/[id]/cert-actions)과 달리, 현장 상세 페이지에서 직접 발급.
 * 동일 (book, partner, site) 의 모든 미발급 sale 에 cert_id 일괄 부여.
 */
export async function issueDeliveryCertBySite(
  book: Book,
  partnerId: string,
  siteId: string,
): Promise<IssueCertResult> {
  const supabase = await createClient();

  // 1. 기존 cert 조회 (정상 시드 — 도메인상 1장만 존재)
  const { data: existing } = await supabase
    .from("delivery_certificate")
    .select("id, doc_no")
    .eq("book", book)
    .eq("partner_id", partnerId)
    .eq("site_id", siteId)
    .is("deleted_at", null)
    .maybeSingle();

  let certId: string;
  let docNo: string;
  let alreadyExisted = false;

  if (existing) {
    certId = existing.id;
    docNo = existing.doc_no;
    alreadyExisted = true;
  } else {
    // 2. 새 cert 생성
    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);
    const { count } = await supabase
      .from("delivery_certificate")
      .select("id", { count: "exact", head: true })
      .gte("issued_on", `${year}-01-01`)
      .lte("issued_on", `${year}-12-31`);
    const newDocNo = `DC-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;

    // 매출 1건 이상 존재 확인 (의미 없는 cert 생성 방지)
    const { count: saleCount } = await supabase
      .from("sale")
      .select("id", { count: "exact", head: true })
      .eq("book", book)
      .eq("partner_id", partnerId)
      .eq("site_id", siteId)
      .is("deleted_at", null);
    if (!saleCount || saleCount === 0) {
      return { ok: false, error: "이 거래처·현장의 매출이 없어 확인서를 발급할 수 없습니다." };
    }

    const { data: created, error: insErr } = await supabase
      .from("delivery_certificate")
      .insert({
        book,
        partner_id: partnerId,
        site_id: siteId,
        doc_no: newDocNo,
        issued_on: today,
      })
      .select("id, doc_no")
      .single();

    if (insErr || !created) {
      return { ok: false, error: friendly(insErr?.message ?? "확인서 생성 실패") };
    }
    certId = created.id;
    docNo = created.doc_no;
  }

  // 3. 미발급 sale 에 일괄 cert_id 부여
  const { error: updErr } = await supabase
    .from("sale")
    .update({ delivery_cert_id: certId })
    .eq("book", book)
    .eq("partner_id", partnerId)
    .eq("site_id", siteId)
    .is("deleted_at", null)
    .is("delivery_cert_id", null);
  if (updErr) return { ok: false, error: friendly(updErr.message) };

  // 캐시 무효화
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/sales`);
    revalidatePath(`/${b}/sites/${siteId}`);
  }

  return { ok: true, cert_id: certId, doc_no: docNo, already_existed: alreadyExisted };
}
