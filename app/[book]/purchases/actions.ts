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
    revalidatePath(`/${b}/payables`);
    revalidatePath(`/${b}/bank`);
  }
}

/**
 * 자료성·세금계산서 종류 → 부가세 유형·세액(매출 computeVat 미러).
 * 계산서=면세(exempt), 무자료/무자료성=불과세(non_taxable) — 부가세 신고대상 뷰에서 자동 제외.
 */
function computeVat(isDocumented: boolean, taxDocType: string, subtotal: number) {
  const vatType =
    !isDocumented || taxDocType === "none"
      ? "non_taxable"
      : taxDocType === "invoice"
        ? "exempt"
        : "standard_10";
  const vatRate = vatType === "standard_10" ? 10 : 0;
  const vat = vatRate > 0 ? Math.round((subtotal * vatRate) / 100) : 0;
  return { vatType, vatRate, vat, total: subtotal + vat };
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

/** site_id 없고 site_name만 있으면 site 마스터 자동 생성(UNIQUE 충돌 시 기존 조회). 매출과 동일. */
async function resolveSiteId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteId: string | null,
  siteName: string | null,
): Promise<string | null> {
  if (siteId) return siteId;
  if (!siteName) return null;
  const trimmed = siteName.trim();
  if (!trimmed) return null;
  const { data: created } = await supabase
    .from("site")
    .insert({ name: trimmed })
    .select("id")
    .maybeSingle();
  if (created) return created.id;
  const { data: existing } = await supabase
    .from("site")
    .select("id")
    .eq("name", trimmed)
    .is("deleted_at", null)
    .maybeSingle();
  return existing?.id ?? null;
}

type CreateInput = {
  book: Book;
  doc_no?: string;
  partner_id: string;
  site_id?: string | null;
  site_name?: string | null;
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
    site_id: str("site_id") || null,
    site_name: str("site_name") || null,
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
  const resolvedSiteId = await resolveSiteId(supabase, parsed.site_id ?? null, parsed.site_name ?? null);
  // 철근(이론중량 있음)은 원/kg 단가 × 실제 중량, 비철근은 단가 × 수량.
  const weightForPrice = parsed.actual_weight_kg ?? parsed.theoretical_weight_kg ?? null;
  const subtotal = weightForPrice
    ? Math.round(parsed.unit_price_krw * weightForPrice)
    : Math.round(parsed.unit_price_krw * parsed.qty);
  const documented = parsed.is_documented;
  const { vatType, vatRate, vat, total } = computeVat(documented, parsed.tax_doc_type, subtotal);

  // 기본 창고/존 해석 (본 야적장) — RPC에 넘겨 원자 생성
  const { data: warehouse } = await supabase
    .from("warehouse")
    .select("id")
    .eq("code", "WH-MAIN")
    .maybeSingle();
  if (!warehouse) {
    return { ok: false, error: "기본 창고(WH-MAIN)가 없습니다. 마이그레이션 스크립트 실행 필요." };
  }
  const { data: zone } = await supabase
    .from("warehouse_zone")
    .select("id")
    .eq("warehouse_id", warehouse.id)
    .eq("preferred_book", parsed.book)
    .maybeSingle();

  // 헤더 + 라인 한 트랜잭션(RPC) — 분리 insert로 라인 실패 시 헤더만 남던 문제 방지.
  const { error: rpcErr } = await supabase.rpc("create_purchase_with_line", {
    p_purchase: {
      book: parsed.book,
      doc_no: docNo,
      partner_id: parsed.partner_id,
      site_id: resolvedSiteId,
      site_name: parsed.site_name,
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
      paid_on: null, // 결제는 '결제' 버튼(통장 출금)으로만 — 생성 시 미결제
      status: parsed.status,
      notes: parsed.notes,
    },
    p_line: {
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
      price_basis: parsed.unit === "kg" ? "actual" : "theoretical",
      line_subtotal_krw: subtotal,
      line_status: parsed.status, // 헤더와 일치 — scrapped/depleted 가 in_stock 유령재고로 남던 문제 방지
    },
  });
  if (rpcErr) return { ok: false, error: friendly(rpcErr.message) };

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

  // 공급가 기준 부가세 재계산(자료종류 전환 시 stale 방지). paid_on 은 결제 RPC 전용이라 여기서 안 건드림.
  const { data: cur } = await supabase.from("purchase").select("subtotal_krw").eq("id", id).single();
  const isDocumented = str("is_documented") === "true";
  const taxDocType = str("tax_doc_type");
  const { vatType, vatRate, vat, total } = computeVat(
    isDocumented,
    taxDocType,
    Number(cur?.subtotal_krw ?? 0),
  );

  const siteName = str("site_name") || null;
  const resolvedSiteId = await resolveSiteId(supabase, str("site_id") || null, siteName);

  // payment_due_on·tax_doc_no 는 매입 폼에서 입력받지 않으므로 편집 update 에서 제외한다.
  // (빈 폼값 ""→null 로 기존 데이터를 덮어쓰던 손실 버그 방지)
  const updates: Record<string, unknown> = {
    site_id: resolvedSiteId,
    site_name: siteName,
    delivered_on: str("delivered_on") || null,
    status: str("status"),
    tax_doc_type: taxDocType,
    is_documented: isDocumented,
    vat_type: vatType,
    vat_rate: vatRate,
    vat_krw: vat,
    total_krw: total,
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

/** 결제완료 — 통장 출금(bank_transaction)을 함께 기록(RPC, 원자적). 통장.book=매입.book 정합 강제. */
export async function markPurchasePaid(
  id: string,
  bankAccountId: string,
  paidOn?: string,
): Promise<PurchaseActionResult> {
  if (!bankAccountId) return { ok: false, error: "결제 통장을 선택해주세요." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("pay_purchase_with_payment", {
    p_purchase_id: id,
    p_bank_account_id: bankAccountId,
    p_paid_on: paidOn || new Date().toISOString().slice(0, 10),
  });
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}

export async function deletePurchase(id: string): Promise<PurchaseActionResult> {
  const supabase = await createClient();
  // RPC가 manager 권한을 강제(soft-delete가 staff UPDATE 정책으로 우회되던 문제 차단).
  const { error } = await supabase.rpc("soft_delete_purchase", { p_id: id });
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}
