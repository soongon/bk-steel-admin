"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
 * 같은 (book, partner_id, site_name) 의 미발급 매출에 cert 일괄 부여.
 * 이미 동일 조합 cert 가 있으면 그 cert 에 연결.
 */
export async function issueDeliveryCertificate(
  saleId: string,
): Promise<IssueCertResult> {
  const supabase = await createClient();

  // 1. sale 컨텍스트 조회
  const { data: sale, error: saleErr } = await supabase
    .from("sale")
    .select("id, book, partner_id, site_name, delivery_cert_id")
    .eq("id", saleId)
    .is("deleted_at", null)
    .maybeSingle();

  if (saleErr) return { ok: false, error: friendly(saleErr.message) };
  if (!sale) return { ok: false, error: "매출을 찾을 수 없습니다." };
  if (sale.delivery_cert_id) {
    return { ok: false, error: "이미 납품확인서가 발급된 매출입니다." };
  }

  // 2. 기존 cert 조회 (book + partner + site_name 일치)
  let findQ = supabase
    .from("delivery_certificate")
    .select("id, doc_no")
    .eq("book", sale.book)
    .eq("partner_id", sale.partner_id)
    .is("deleted_at", null);
  findQ = sale.site_name === null
    ? findQ.is("site_name", null)
    : findQ.eq("site_name", sale.site_name);
  const { data: existing } = await findQ.maybeSingle();

  let certId: string;
  let docNo: string;
  let alreadyExisted = false;

  if (existing) {
    certId = existing.id;
    docNo = existing.doc_no;
    alreadyExisted = true;
  } else {
    // 3. 새 cert 생성 — doc_no 자동 (YYYY 누적 카운트)
    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);
    const { count } = await supabase
      .from("delivery_certificate")
      .select("id", { count: "exact", head: true })
      .gte("issued_on", `${year}-01-01`)
      .lte("issued_on", `${year}-12-31`);
    const newDocNo = `DC-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;

    const { data: created, error: insErr } = await supabase
      .from("delivery_certificate")
      .insert({
        book: sale.book,
        partner_id: sale.partner_id,
        site_name: sale.site_name,
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

  // 4. 같은 (book, partner, site) 의 모든 미발급 sale 에 cert_id 일괄 부여
  let updQ = supabase
    .from("sale")
    .update({ delivery_cert_id: certId })
    .eq("book", sale.book)
    .eq("partner_id", sale.partner_id)
    .is("deleted_at", null)
    .is("delivery_cert_id", null);
  updQ = sale.site_name === null
    ? updQ.is("site_name", null)
    : updQ.eq("site_name", sale.site_name);
  const { error: updErr } = await updQ;
  if (updErr) return { ok: false, error: friendly(updErr.message) };

  revalidatePath(`/${sale.book}/sales`);
  revalidatePath(`/${sale.book}/sales/${saleId}`);
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/sales`);
  }

  return { ok: true, cert_id: certId, doc_no: docNo, already_existed: alreadyExisted };
}
