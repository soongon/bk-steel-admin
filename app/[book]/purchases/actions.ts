"use server";

import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";
import { resolveSiteId } from "@/lib/site";
import { computeVat, revalidateTransactionPaths } from "@/lib/transaction";

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

async function generateDocNo(orderedOn: string): Promise<string> {
  const supabase = await createClient();
  const datePart = orderedOn.replace(/-/g, "");
  const { count } = await supabase
    .from("purchase")
    .select("id", { count: "exact", head: true })
    .eq("ordered_on", orderedOn);
  return `${datePart}-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

type PurchaseLineInput = {
  item_id: string;
  unit: "ton" | "kg" | "ea" | "piece" | "bundle";
  qty: number;
  unit_price_krw: number;
  bars_count: number | null;
  theoretical_weight_kg: number | null;
  actual_weight_kg: number | null;
};
type CreateInput = {
  book: Book;
  doc_no?: string;
  partner_id: string;
  site_id?: string | null;
  site_name?: string | null;
  ordered_on: string;
  delivered_on?: string | null;
  paid_on?: string | null;
  lines: PurchaseLineInput[];
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
  const book = str("book") as Book;
  if (!book || !["bk", "sl", "b"].includes(book)) return { error: "책을 선택해주세요." };
  const partner_id = str("partner_id");
  if (!partner_id) return { error: "매입처를 선택해주세요." };
  const ordered_on = str("ordered_on");
  if (!ordered_on) return { error: "발주일을 입력해주세요." };

  // 품목 라인 — 폼이 JSON 배열로 전송(여러 품목)
  let lines: PurchaseLineInput[];
  try {
    const raw: unknown = JSON.parse(str("lines") || "[]");
    if (!Array.isArray(raw) || raw.length === 0) {
      return { error: "품목을 1개 이상 추가해주세요." };
    }
    const numOr = (v: unknown) => (v != null && v !== "" ? Number(v) : null);
    lines = raw.map((l) => {
      const o = l as Record<string, unknown>;
      return {
        item_id: String(o.item_id ?? ""),
        unit: String(o.unit ?? "") as PurchaseLineInput["unit"],
        qty: Number(o.qty) || 0,
        unit_price_krw: Number(o.unit_price_krw) || 0,
        bars_count: numOr(o.bars_count),
        theoretical_weight_kg: numOr(o.theoretical_weight_kg),
        actual_weight_kg: numOr(o.actual_weight_kg),
      };
    });
  } catch {
    return { error: "품목 데이터를 읽지 못했습니다." };
  }
  for (const l of lines) {
    if (!l.item_id) return { error: "품목을 선택해주세요." };
    if (!l.unit) return { error: "단위를 선택해주세요." };
    if (l.qty <= 0) return { error: "수량을 입력해주세요." };
    if (l.unit_price_krw <= 0) return { error: "단가를 입력해주세요." };
  }

  const is_documented = str("is_documented") === "true";
  const tax_doc_type = (str("tax_doc_type") || (book === "b" ? "none" : "tax_invoice_electronic")) as CreateInput["tax_doc_type"];
  const status = (str("status") || "ordered") as CreateInput["status"];

  return {
    book,
    doc_no: str("doc_no") || undefined,
    partner_id,
    site_id: str("site_id") || null,
    site_name: str("site_name") || null,
    ordered_on,
    delivered_on: str("delivered_on") || null,
    paid_on: str("paid_on") || null,
    lines,
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

  // 기본 창고/존 해석 (본 야적장) — 모든 라인 공통.
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

  // 라인별 공급가(철근=원/kg×실제중량, 비철근=단가×수량) → 헤더 합계 + RPC 라인 배열.
  const lines = parsed.lines.map((l) => {
    const weightForPrice = l.actual_weight_kg ?? l.theoretical_weight_kg ?? null;
    const lineSubtotal = weightForPrice
      ? Math.round(l.unit_price_krw * weightForPrice)
      : Math.round(l.unit_price_krw * l.qty);
    return {
      warehouse_id: warehouse.id,
      warehouse_zone_id: zone?.id ?? null,
      item_id: l.item_id,
      acquired_unit: l.unit,
      acquired_qty: l.qty,
      unit_price_krw: l.unit_price_krw,
      bars_count: l.bars_count,
      theoretical_weight_kg: l.theoretical_weight_kg,
      actual_weight_kg: l.actual_weight_kg,
      invoiced_weight_kg: l.actual_weight_kg ?? l.theoretical_weight_kg,
      price_basis: l.unit === "kg" ? "actual" : "theoretical",
      line_subtotal_krw: lineSubtotal,
      line_status: parsed.status, // 헤더와 일치 — scrapped/depleted 가 in_stock 유령재고로 남던 문제 방지
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.line_subtotal_krw, 0);
  const documented = parsed.is_documented;
  const { vatType, vatRate, vat, total } = computeVat(documented, parsed.tax_doc_type, subtotal);

  // 헤더 + 라인 N개 한 트랜잭션(RPC) — 분리 insert로 라인 실패 시 헤더만 남던 문제 방지.
  const { error: rpcErr } = await supabase.rpc("create_purchase_with_lines", {
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
    p_lines: lines,
  });
  if (rpcErr) return { ok: false, error: friendly(rpcErr.message) };

  revalidateTransactionPaths("purchases");
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
  revalidateTransactionPaths("purchases");
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

  revalidateTransactionPaths("purchases");
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
  revalidateTransactionPaths("purchases");
  return { ok: true };
}

export async function deletePurchase(id: string): Promise<PurchaseActionResult> {
  const supabase = await createClient();
  // RPC가 manager 권한을 강제(soft-delete가 staff UPDATE 정책으로 우회되던 문제 차단).
  const { error } = await supabase.rpc("soft_delete_purchase", { p_id: id });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateTransactionPaths("purchases");
  return { ok: true };
}

/** 세금계산서 수취 토글 — done이면 오늘 날짜, 아니면 null(라이프사이클 단계 표시용 단순 플래그). */
export async function togglePurchaseTaxInvoiceReceived(id: string, done: boolean): Promise<PurchaseActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase")
    .update({ tax_invoice_received_on: done ? new Date().toISOString().slice(0, 10) : null })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateTransactionPaths("purchases");
  return { ok: true };
}
