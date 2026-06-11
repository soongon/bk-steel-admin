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
    revalidatePath(`/${b}/receivables`);
    revalidatePath(`/${b}/bank`);
  }
}

/** 매출 상태 전이 규칙 — 주문→확정→납품완료→수금완료(+연체·취소). 같은 상태는 무변경 허용. */
const SALE_TRANSITIONS: Record<string, string[]> = {
  reserved: ["confirmed", "delivered", "cancelled"],
  confirmed: ["delivered", "cancelled"],
  delivered: ["settled", "cancelled"],
  overdue: ["settled", "cancelled"],
  settled: [],
  cancelled: [],
};
const STATUS_LABEL: Record<string, string> = {
  reserved: "주문",
  confirmed: "확정",
  delivered: "납품완료",
  settled: "수금완료",
  overdue: "연체",
  cancelled: "취소",
};

/** 전이가 불가능하면 사용자용 메시지, 가능하면 null. */
function transitionError(from: string, to: string): string | null {
  if (from === to) return null;
  if ((SALE_TRANSITIONS[from] ?? []).includes(to)) return null;
  return `'${STATUS_LABEL[from] ?? from}' → '${STATUS_LABEL[to] ?? to}' 상태 전이는 허용되지 않습니다.`;
}

/**
 * 자료성·세금계산서 종류 → 부가세 유형·세액.
 * 계산서=면세(exempt), 무자료/무자료성=불과세(non_taxable) — 둘 다 부가세 신고대상 뷰에서 자동 제외.
 * 그 외 자료거래(세금계산서·현금영수증 등)는 과세 10%.
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
  site_id?: string | null;
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
    site_id: str("site_id") || null,
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
    notes: str("notes") || null,
  };
}

/**
 * site_id 가 없고 site_name 만 있는 경우(미등록 현장) site 마스터 자동 생성.
 * UNIQUE(name) 충돌 시 기존 row 조회로 fallback.
 */
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

  // UNIQUE 충돌 등 → 기존 row 조회
  const { data: existing } = await supabase
    .from("site")
    .select("id")
    .eq("name", trimmed)
    .is("deleted_at", null)
    .maybeSingle();
  return existing?.id ?? null;
}

export async function createSale(formData: FormData): Promise<SaleActionResult> {
  const parsed = readCreateInput(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();

  const docNo = parsed.doc_no ?? (await generateDocNo(parsed.ordered_on));
  const resolvedSiteId = await resolveSiteId(supabase, parsed.site_id ?? null, parsed.site_name ?? null);
  // 철근(weight_kg 있음)은 원/kg 단가 × 실제 이론중량, 비철근은 단가 × 수량.
  const subtotal = parsed.weight_kg
    ? Math.round(parsed.unit_price_krw * parsed.weight_kg)
    : Math.round(parsed.unit_price_krw * parsed.qty);
  const documented = parsed.is_documented;
  const { vatType, vatRate, vat, total } = computeVat(documented, parsed.tax_doc_type, subtotal);

  // 헤더 + 라인 한 트랜잭션(RPC) — 분리 insert 시 라인 실패하면 헤더만 남던 문제 방지.
  const { error: rpcErr } = await supabase.rpc("create_sale_with_line", {
    p_sale: {
      book: parsed.book,
      doc_no: docNo,
      partner_id: parsed.partner_id,
      site_id: resolvedSiteId,
      site_name: parsed.site_name,
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
      notes: parsed.notes,
    },
    p_line: {
      item_id: parsed.item_id,
      unit: parsed.unit,
      qty: parsed.qty,
      unit_price_krw: parsed.unit_price_krw,
      weight_kg: parsed.weight_kg,
      line_subtotal_krw: subtotal,
    },
  });
  if (rpcErr) return { ok: false, error: friendly(rpcErr.message) };

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

  // 현재 상태·공급가 — 전이 검증 + 부가세 재계산 기준
  const { data: cur } = await supabase
    .from("sale")
    .select("status, subtotal_krw")
    .eq("id", id)
    .single();

  const newStatus = str("status");
  if (cur) {
    const tErr = transitionError(cur.status, newStatus);
    if (tErr) return { ok: false, error: tErr };
  }
  if (newStatus === "settled") {
    return { ok: false, error: "수금완료는 매출 목록의 '수금' 버튼(통장 선택)으로 처리하세요." };
  }

  const siteName = str("site_name") || null;
  const siteIdInput = str("site_id") || null;
  const resolvedSiteId = await resolveSiteId(supabase, siteIdInput, siteName);

  const isDocumented = str("is_documented") === "true";
  const taxDocType = str("tax_doc_type");
  const { vatType, vatRate, vat, total } = computeVat(
    isDocumented,
    taxDocType,
    Number(cur?.subtotal_krw ?? 0),
  );

  const updates: Record<string, unknown> = {
    site_id: resolvedSiteId,
    site_name: siteName,
    delivered_on: str("delivered_on") || null,
    payment_due_on: str("payment_due_on") || null,
    status: newStatus,
    tax_doc_type: taxDocType,
    is_documented: isDocumented,
    vat_type: vatType,
    vat_rate: vatRate,
    vat_krw: vat,
    total_krw: total,
    notes: str("notes") || null,
  };
  if (newStatus === "cancelled") {
    updates.settled_on = null;
  }

  const { error } = await supabase.from("sale").update(updates).eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}

/** 납품완료 처리 — 주문/확정 → 납품완료(헤더+라인). delivered_on 미기록 시 오늘로. */
export async function markSaleDelivered(id: string): Promise<SaleActionResult> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: cur } = await supabase
    .from("sale")
    .select("status, delivered_on")
    .eq("id", id)
    .single();
  if (cur) {
    const tErr = transitionError(cur.status, "delivered");
    if (tErr) return { ok: false, error: tErr };
  }
  const { error } = await supabase
    .from("sale")
    .update({ status: "delivered", delivered_on: cur?.delivered_on ?? today })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  await supabase
    .from("sale_line")
    .update({ status: "delivered" })
    .eq("sale_id", id)
    .neq("status", "cancelled");
  bumpRevalidation();
  return { ok: true };
}

/**
 * 수금완료 — 통장 입금(bank_transaction)을 함께 기록(RPC, 원자적).
 * 통장.book = 매출.book 정합·납품완료 전제는 RPC가 강제.
 */
export async function settleSale(
  id: string,
  bankAccountId: string,
  settledOn?: string,
): Promise<SaleActionResult> {
  if (!bankAccountId) return { ok: false, error: "수금 통장을 선택해주세요." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("settle_sale_with_payment", {
    p_sale_id: id,
    p_bank_account_id: bankAccountId,
    p_settled_on: settledOn || new Date().toISOString().slice(0, 10),
  });
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}

export async function cancelSale(id: string): Promise<SaleActionResult> {
  const supabase = await createClient();
  const { data: cur } = await supabase.from("sale").select("status").eq("id", id).single();
  if (cur?.status === "cancelled") return { ok: true };
  if (cur?.status === "settled") {
    return { ok: false, error: "수금완료된 매출은 취소할 수 없습니다(환불 처리 필요)." };
  }
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
  // RPC가 manager 권한을 강제(soft-delete가 staff UPDATE 정책으로 우회되던 문제 차단).
  const { error } = await supabase.rpc("soft_delete_sale", { p_id: id });
  if (error) return { ok: false, error: friendly(error.message) };
  bumpRevalidation();
  return { ok: true };
}
