"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";

export type SaleActionResult = { ok: true } | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("sale_doc_no_key")) return "이미 사용 중인 문서번호입니다.";
  if (message.includes("chk_bk_documented_sale")) return "법인 매출은 자료거래(세금계산서)가 필수입니다.";
  if (message.includes("chk_b_undocumented_sale")) return "B계좌 매출은 무자료만 가능합니다.";
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
}

function bumpRevalidation() {
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/sales`);
    revalidatePath(`/${b}/dashboard`);
  }
}

/**
 * 책+일자 기반 doc_no 자동 생성 (YYYYMMDD-NNN).
 * race condition은 UNIQUE 제약으로 catch.
 */
async function generateDocNo(orderedOn: string): Promise<string> {
  const supabase = await createClient();
  const datePart = orderedOn.replace(/-/g, "");
  const { count } = await supabase
    .from("sale")
    .select("id", { count: "exact", head: true })
    .eq("ordered_on", orderedOn);
  return `${datePart}-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

type CreateInput = {
  book: Book;
  doc_no?: string;
  partner_id: string;
  site_name?: string | null;
  ordered_on: string;
  delivered_on?: string | null;
  item_id: string;
  unit: "ton" | "kg" | "ea" | "piece" | "bundle";
  qty: number;
  unit_price_krw: number;
  weight_kg?: number | null;
  status: "reserved" | "confirmed" | "delivered" | "settled" | "cancelled";
  is_documented: boolean;
  tax_doc_type: "tax_invoice_electronic" | "tax_invoice_paper" | "invoice" | "cash_receipt" | "simple_receipt" | "none";
  payment_due_on?: string | null;
};

function readCreateInput(fd: FormData): CreateInput | { error: string } {
  const str = (k: string) => {
    const v = fd.get(k);
    if (typeof v !== "string") return "";
    return v.trim();
  };
  const num = (k: string) => {
    const v = str(k).replace(/[, ]/g, "");
    return v === "" ? 0 : Number(v);
  };

  const book = str("book") as Book;
  if (!book || !["bk", "sl", "b"].includes(book)) return { error: "책을 선택해주세요." };
  const partner_id = str("partner_id");
  if (!partner_id) return { error: "거래처를 선택해주세요." };
  const ordered_on = str("ordered_on");
  if (!ordered_on) return { error: "주문일을 입력해주세요." };
  const item_id = str("item_id");
  if (!item_id) return { error: "품목을 선택해주세요." };
  const unit = str("unit") as CreateInput["unit"];
  if (!unit) return { error: "단위를 선택해주세요." };
  const qty = num("qty");
  if (qty <= 0) return { error: "수량을 입력해주세요." };
  const unit_price_krw = num("unit_price_krw");
  if (unit_price_krw <= 0) return { error: "단가를 입력해주세요." };

  const is_documented = str("is_documented") === "true";
  const tax_doc_type = (str("tax_doc_type") || (book === "b" ? "none" : "tax_invoice_electronic")) as CreateInput["tax_doc_type"];
  const status = (str("status") || "reserved") as CreateInput["status"];
  const weight_kg_str = str("weight_kg");
  const weight_kg = weight_kg_str ? Number(weight_kg_str) : null;

  return {
    book,
    doc_no: str("doc_no") || undefined,
    partner_id,
    site_name: str("site_name") || null,
    ordered_on,
    delivered_on: str("delivered_on") || null,
    item_id,
    unit,
    qty,
    unit_price_krw,
    weight_kg,
    status,
    is_documented,
    tax_doc_type,
    payment_due_on: str("payment_due_on") || null,
  };
}

export async function createSale(formData: FormData): Promise<SaleActionResult> {
  const parsed = readCreateInput(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();

  const docNo = parsed.doc_no ?? (await generateDocNo(parsed.ordered_on));
  const subtotal = Math.round(parsed.unit_price_krw * parsed.qty);
  const documented = parsed.is_documented;
  const vatType = documented && parsed.tax_doc_type !== "invoice" && parsed.tax_doc_type !== "none"
    ? "standard_10"
    : "zero_rated";
  const vatRate = vatType === "standard_10" ? 10 : 0;
  const vat = vatRate > 0 ? Math.round(subtotal * 0.1) : 0;
  const total = subtotal + vat;

  // 매출 헤더
  const { data: sale, error: saleErr } = await supabase
    .from("sale")
    .insert({
      book: parsed.book,
      doc_no: docNo,
      partner_id: parsed.partner_id,
      site_name: parsed.site_name,
      sale_subtype: "external",
      ordered_on: parsed.ordered_on,
      delivered_on: parsed.delivered_on,
      is_documented: documented,
      tax_doc_type: parsed.tax_doc_type,
      vat_type: vatType,
      vat_rate: vatRate,
      subtotal_krw: subtotal,
      vat_krw: vat,
      total_krw: total,
      payment_due_on: parsed.payment_due_on,
      settled_on: parsed.status === "settled" ? (parsed.delivered_on ?? parsed.ordered_on) : null,
      status: parsed.status,
    })
    .select("id")
    .single();
  if (saleErr || !sale) return { ok: false, error: friendly(saleErr?.message ?? "매출 생성 실패") };

  // 라인
  const { error: lineErr } = await supabase.from("sale_line").insert({
    sale_id: sale.id,
    book: parsed.book,
    item_id: parsed.item_id,
    unit: parsed.unit,
    qty: parsed.qty,
    unit_price_krw: parsed.unit_price_krw,
    weight_kg: parsed.weight_kg,
    theoretical_weight_kg: parsed.weight_kg,
    price_basis: "theoretical",
    line_subtotal_krw: subtotal,
    status: parsed.status,
  });
  if (lineErr) return { ok: false, error: friendly(lineErr.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function updateSaleHeader(
  id: string,
  formData: FormData,
): Promise<SaleActionResult> {
  const supabase = await createClient();
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };

  const updates: Record<string, unknown> = {
    site_name: str("site_name") || null,
    delivered_on: str("delivered_on") || null,
    payment_due_on: str("payment_due_on") || null,
    status: str("status"),
    tax_doc_type: str("tax_doc_type"),
    is_documented: str("is_documented") === "true",
  };
  if (updates.status === "settled") {
    updates.settled_on = str("delivered_on") || str("ordered_on") || new Date().toISOString().slice(0, 10);
  } else if (updates.status === "cancelled") {
    updates.settled_on = null;
  }

  const { error } = await supabase.from("sale").update(updates).eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}

export async function settleSale(id: string): Promise<SaleActionResult> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("sale")
    .update({ status: "settled", settled_on: today })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}

export async function cancelSale(id: string): Promise<SaleActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sale")
    .update({ status: "cancelled", settled_on: null })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}

export async function deleteSale(id: string): Promise<SaleActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sale")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}
