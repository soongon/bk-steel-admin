"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";

export type PurchaseActionResult = { ok: true } | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("purchase_doc_no_key")) return "이미 사용 중인 문서번호입니다.";
  if (message.includes("chk_bk_documented")) return "법인 매입은 자료거래(세금계산서)가 필수입니다.";
  if (message.includes("chk_b_undocumented")) return "B계좌 매입은 무자료만 가능합니다.";
  if (message.includes("chk_kg_unit_actual_required")) return "kg 단위 매입은 실중량이 필수입니다.";
  if (message.includes("chk_bars_count_required")) return "가닥/번들 단위는 가닥수가 필요합니다.";
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
}

function bumpRevalidation() {
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/purchases`);
    revalidatePath(`/${b}/dashboard`);
  }
}

async function generateDocNo(orderedOn: string): Promise<string> {
  const supabase = await createClient();
  const datePart = orderedOn.replace(/-/g, "");
  const { count } = await supabase
    .from("purchase")
    .select("id", { count: "exact", head: true })
    .eq("ordered_on", orderedOn);
  return `${datePart}-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

type CreateInput = {
  book: Book;
  doc_no?: string;
  partner_id: string;
  ordered_on: string;
  delivered_on?: string | null;
  paid_on?: string | null;
  item_id: string;
  unit: "ton" | "kg" | "ea" | "piece" | "bundle";
  qty: number;
  unit_price_krw: number;
  bars_count?: number | null;
  theoretical_weight_kg?: number | null;
  actual_weight_kg?: number | null;
  status: "ordered" | "in_stock" | "partial_out" | "depleted" | "transferred_out" | "scrapped";
  is_documented: boolean;
  tax_doc_type: "tax_invoice_electronic" | "tax_invoice_paper" | "invoice" | "cash_receipt" | "simple_receipt" | "none";
  tax_doc_no?: string | null;
  payment_due_on?: string | null;
  notes?: string | null;
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
  if (!partner_id) return { error: "매입처를 선택해주세요." };
  const ordered_on = str("ordered_on");
  if (!ordered_on) return { error: "발주일을 입력해주세요." };
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
  const status = (str("status") || "ordered") as CreateInput["status"];

  const theo_str = str("theoretical_weight_kg");
  const actual_str = str("actual_weight_kg");
  const bars_str = str("bars_count");

  return {
    book,
    doc_no: str("doc_no") || undefined,
    partner_id,
    ordered_on,
    delivered_on: str("delivered_on") || null,
    paid_on: str("paid_on") || null,
    item_id,
    unit,
    qty,
    unit_price_krw,
    bars_count: bars_str ? Number(bars_str) : null,
    theoretical_weight_kg: theo_str ? Number(theo_str) : null,
    actual_weight_kg: actual_str ? Number(actual_str) : null,
    status,
    is_documented,
    tax_doc_type,
    tax_doc_no: str("tax_doc_no") || null,
    payment_due_on: str("payment_due_on") || null,
    notes: str("notes") || null,
  };
}

export async function createPurchase(formData: FormData): Promise<PurchaseActionResult> {
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

  // 매입 헤더
  const { data: purchase, error: purErr } = await supabase
    .from("purchase")
    .insert({
      book: parsed.book,
      doc_no: docNo,
      partner_id: parsed.partner_id,
      purchase_subtype: "external",
      ordered_on: parsed.ordered_on,
      delivered_on: parsed.delivered_on,
      is_documented: documented,
      tax_doc_type: parsed.tax_doc_type,
      tax_doc_no: parsed.tax_doc_no,
      vat_type: vatType,
      vat_rate: vatRate,
      subtotal_krw: subtotal,
      vat_krw: vat,
      total_krw: total,
      payment_due_on: parsed.payment_due_on,
      paid_on: parsed.paid_on,
      status: parsed.status,
      notes: parsed.notes,
    })
    .select("id")
    .single();
  if (purErr || !purchase) return { ok: false, error: friendly(purErr?.message ?? "매입 생성 실패") };

  // 매입 라인 (creating warehouse default - 본 야적장)
  const { data: warehouse } = await supabase
    .from("warehouse")
    .select("id")
    .eq("code", "WH-MAIN")
    .maybeSingle();
  const { data: zone } = warehouse
    ? await supabase
        .from("warehouse_zone")
        .select("id")
        .eq("warehouse_id", warehouse.id)
        .eq("preferred_book", parsed.book)
        .maybeSingle()
    : { data: null };

  if (!warehouse) {
    return { ok: false, error: "기본 창고(WH-MAIN)가 없습니다. 마이그레이션 스크립트 실행 필요." };
  }

  const isKgUnit = parsed.unit === "kg";
  const priceBasis = isKgUnit ? "actual" : "theoretical";

  const { error: lineErr } = await supabase.from("purchase_line").insert({
    purchase_id: purchase.id,
    book: parsed.book,
    warehouse_id: warehouse.id,
    warehouse_zone_id: zone?.id ?? null,
    item_id: parsed.item_id,
    acquired_unit: parsed.unit,
    acquired_qty: parsed.qty,
    unit_price_krw: parsed.unit_price_krw,
    bars_count: parsed.bars_count,
    theoretical_weight_kg: parsed.theoretical_weight_kg,
    actual_weight_kg: parsed.actual_weight_kg,
    invoiced_weight_kg: parsed.actual_weight_kg ?? parsed.theoretical_weight_kg,
    price_basis: priceBasis,
    line_subtotal_krw: subtotal,
    status: parsed.status === "ordered" ? "ordered" : "in_stock",
  });
  if (lineErr) return { ok: false, error: friendly(lineErr.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function updatePurchaseHeader(
  id: string,
  formData: FormData,
): Promise<PurchaseActionResult> {
  const supabase = await createClient();
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };

  const updates: Record<string, unknown> = {
    delivered_on: str("delivered_on") || null,
    payment_due_on: str("payment_due_on") || null,
    paid_on: str("paid_on") || null,
    status: str("status"),
    tax_doc_type: str("tax_doc_type"),
    tax_doc_no: str("tax_doc_no") || null,
    is_documented: str("is_documented") === "true",
    notes: str("notes") || null,
  };

  const { error } = await supabase.from("purchase").update(updates).eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}

export async function markPurchaseReceived(id: string): Promise<PurchaseActionResult> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // header
  const { error: hErr } = await supabase
    .from("purchase")
    .update({ status: "in_stock", delivered_on: today })
    .eq("id", id);
  if (hErr) return { ok: false, error: friendly(hErr.message) };

  // lines (도착 상태로)
  const { error: lErr } = await supabase
    .from("purchase_line")
    .update({ status: "in_stock" })
    .eq("purchase_id", id)
    .eq("status", "ordered");
  if (lErr) return { ok: false, error: friendly(lErr.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function markPurchasePaid(id: string): Promise<PurchaseActionResult> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("purchase")
    .update({ paid_on: today })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}

export async function deletePurchase(id: string): Promise<PurchaseActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}
