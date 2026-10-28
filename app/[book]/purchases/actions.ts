"use server";

import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWork, adminUrl, fmtWon } from "@/lib/kakaowork";
import { resolveSiteId } from "@/lib/site";
import { resolvePartnerId } from "@/lib/partner";
import { computeVat, revalidateTransactionPaths } from "@/lib/transaction";
import { kstToday } from "@/lib/format";

export type PurchaseActionResult = { ok: true } | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("purchase_doc_no_key")) return "이미 사용 중인 문서번호입니다.";
  if (message.includes("chk_bk_documented")) return "법인 매입은 자료거래(세금계산서)가 필수입니다.";
  if (message.includes("chk_b_undocumented")) return "B계좌 매입은 무자료만 가능합니다.";
  if (message.includes("chk_kg_unit_actual_required")) return "kg 단위 매입은 실중량이 필수입니다.";
  if (message.includes("chk_bars_count_required")) return "가닥/번들 단위는 가닥수가 필요합니다.";
  if (message.includes("row-level security")) return "권한이 없습니다.";
  if (message.includes("Could not find the function") && message.includes("replace_purchase_lines")) {
    return "품목 수정 기능(마이그레이션 0093)이 DB에 아직 적용되지 않았습니다.";
  }
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
  notes: string | null; // 라인 비고(홈택스 계산서분·조정 라인 사유)
  allow_negative: boolean; // 계산서 금액 맞춤 조정 라인 — 음수 단가 허용
};

/**
 * 폼의 lines JSON(serializePurchaseLines 출력) → 검증된 라인 입력. 신규 등록·라인 수정(0093) 공용.
 * 조정 라인(allow_negative)은 음수 단가 가능 — 그 외는 단가>0. kg 단위는 실중량 필수(DB CHECK 와 같은 뜻).
 */
function parsePurchaseLinesJson(raw: string): { lines: PurchaseLineInput[] } | { error: string } {
  let lines: PurchaseLineInput[];
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { error: "품목을 1개 이상 추가해주세요." };
    }
    const numOr = (v: unknown) => (v != null && v !== "" ? Number(v) : null);
    lines = parsed.map((l) => {
      const o = l as Record<string, unknown>;
      return {
        item_id: String(o.item_id ?? ""),
        unit: String(o.unit ?? "") as PurchaseLineInput["unit"],
        qty: Number(o.qty) || 0,
        unit_price_krw: Number(o.unit_price_krw) || 0,
        bars_count: numOr(o.bars_count),
        theoretical_weight_kg: numOr(o.theoretical_weight_kg),
        actual_weight_kg: numOr(o.actual_weight_kg),
        notes: typeof o.notes === "string" && o.notes.trim() ? o.notes.trim() : null,
        allow_negative: o.allow_negative === true,
      };
    });
  } catch {
    return { error: "품목 데이터를 읽지 못했습니다." };
  }
  for (const l of lines) {
    if (!l.item_id) return { error: "품목을 선택해주세요." };
    if (!l.unit) return { error: "단위를 선택해주세요." };
    if (l.qty <= 0) return { error: "수량을 입력해주세요." };
    if (l.allow_negative) {
      if (l.unit_price_krw === 0) return { error: "조정 라인 금액이 0입니다." };
    } else if (l.unit_price_krw <= 0) {
      return { error: "단가를 입력해주세요." };
    }
    if (l.unit === "kg" && l.actual_weight_kg == null) return { error: "kg 단위 매입은 실중량이 필수입니다." };
  }
  return { lines };
}

/**
 * 라인별 공급가(철근=원/kg×실중량(없으면 이론중량), 비철근=단가×수량) → RPC(create/replace)가 받는 형태.
 * 가닥(ea) 단위에 가닥수가 없으면 수량을 가닥수로(철제 ea 라인이 chk_bars_count_required 에 걸리던 문제).
 */
function toRpcPurchaseLines(lines: PurchaseLineInput[], status: string) {
  return lines.map((l) => {
    const weightForPrice = l.actual_weight_kg ?? l.theoretical_weight_kg ?? null;
    const lineSubtotal = weightForPrice
      ? Math.round(l.unit_price_krw * weightForPrice)
      : Math.round(l.unit_price_krw * l.qty);
    const barsCount =
      l.bars_count ?? (l.unit === "ea" || l.unit === "piece" || l.unit === "bundle" ? Math.round(l.qty) : null);
    return {
      item_id: l.item_id,
      acquired_unit: l.unit,
      acquired_qty: l.qty,
      unit_price_krw: l.unit_price_krw,
      bars_count: barsCount,
      theoretical_weight_kg: l.theoretical_weight_kg,
      actual_weight_kg: l.actual_weight_kg,
      invoiced_weight_kg: l.actual_weight_kg ?? l.theoretical_weight_kg,
      price_basis: l.unit === "kg" ? "actual" : "theoretical",
      line_subtotal_krw: lineSubtotal,
      line_status: status, // 헤더와 일치 — scrapped/depleted 가 in_stock 유령재고로 남던 문제 방지
      notes: l.notes,
    };
  });
}
type CreateInput = {
  book: Book;
  doc_no?: string;
  partner_id?: string; // 미등록 매입처면 partner_name 으로 자동 생성(resolvePartnerId)
  partner_name?: string | null;
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
  const partner_name = str("partner_name");
  if (!partner_id && !partner_name) return { error: "매입처를 입력해주세요." };
  const ordered_on = str("ordered_on");
  if (!ordered_on) return { error: "발주일을 입력해주세요." };

  // 품목 라인 — 폼이 JSON 배열로 전송(여러 품목)
  const parsedLines = parsePurchaseLinesJson(str("lines"));
  if ("error" in parsedLines) return parsedLines;
  const lines = parsedLines.lines;

  const is_documented = str("is_documented") === "true";
  const tax_doc_type = (str("tax_doc_type") || (book === "b" ? "none" : "tax_invoice_electronic")) as CreateInput["tax_doc_type"];
  const status = (str("status") || "ordered") as CreateInput["status"];

  return {
    book,
    doc_no: str("doc_no") || undefined,
    partner_id: partner_id || undefined,
    partner_name: partner_name || null,
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
  // 매입처: id 없으면 이름으로 자동 생성/조회(매출과 동일).
  const resolvedPartnerId = await resolvePartnerId(supabase, parsed.partner_id ?? null, parsed.partner_name ?? null);
  if (!resolvedPartnerId) return { ok: false, error: "매입처를 확인해주세요." };

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

  // 라인별 공급가 → 헤더 합계 + RPC 라인 배열(창고·존은 모든 라인 공통).
  const lines = toRpcPurchaseLines(parsed.lines, parsed.status).map((l) => ({
    warehouse_id: warehouse.id,
    warehouse_zone_id: zone?.id ?? null,
    ...l,
  }));
  const subtotal = lines.reduce((s, l) => s + l.line_subtotal_krw, 0);
  const documented = parsed.is_documented;
  const { vatType, vatRate, vat, total } = computeVat(documented, parsed.tax_doc_type, subtotal);

  // 헤더 + 라인 N개 한 트랜잭션(RPC) — 분리 insert로 라인 실패 시 헤더만 남던 문제 방지.
  const { error: rpcErr } = await supabase.rpc("create_purchase_with_lines", {
    p_purchase: {
      book: parsed.book,
      doc_no: docNo,
      partner_id: resolvedPartnerId,
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
  await notifyKakaoWork(
    `🔵 신규 매입 · ${BOOK_LABEL[parsed.book as Book]}\n` +
      `매입처: ${parsed.partner_name ?? "—"}\n` +
      `금액: ${fmtWon(total)} ${parsed.is_documented ? "(자료)" : "(무자료)"}\n` +
      `문서: ${docNo}\n` +
      adminUrl(`/${parsed.book}/purchases?doc=${docNo}`),
  );
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

  // 공급가 기준 부가세 재계산은 부가세 유형(과세·면세·불과세)이 바뀔 때만 — 같은 유형(전자↔종이세금계산서·현금영수증 등)이면
  // 지금 세액·합계를 둔다(홈택스 계산서 세액 끝전·결제 금액과 어긋나지 않게). paid_on 은 결제 RPC 전용이라 여기서 안 건드림.
  const { data: cur } = await supabase
    .from("purchase")
    .select("subtotal_krw, vat_krw, total_krw, vat_type, vat_rate, is_documented, tax_doc_type, paid_on")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cur) return { ok: false, error: "매입을 찾을 수 없습니다(삭제됐을 수 있습니다)." };
  const isDocumented = str("is_documented") === "true";
  const taxDocType = str("tax_doc_type");
  const next = computeVat(isDocumented, taxDocType, Number(cur.subtotal_krw ?? 0));
  const vatChanged = next.vatType !== String(cur.vat_type);
  if (vatChanged && next.total !== Number(cur.total_krw)) {
    // 결제완료·홈택스 계산서 연결 매입은 합계를 바꾸지 않는다 — 품목 수정(0093 replace_purchase_lines)과 같은 기준.
    const { count: htCount } = await supabase
      .from("hometax_invoice")
      .select("id", { count: "exact", head: true })
      .eq("purchase_id", id)
      .is("deleted_at", null);
    if (cur.paid_on) {
      return {
        ok: false,
        error: "결제완료된 매입은 자료종류를 바꿔 합계를 바꿀 수 없습니다 — 새 매입을 만들고 이 매입을 삭제(결제·계산서 옮기기)하세요.",
      };
    }
    if ((htCount ?? 0) > 0) {
      return { ok: false, error: "홈택스 계산서와 연결된 매입은 자료종류를 바꿔 합계를 바꿀 수 없습니다(국세청 계산서 금액 기준)." };
    }
  }
  const { vatType, vatRate, vat, total } = vatChanged
    ? next
    : {
        vatType: String(cur.vat_type),
        vatRate: Number(cur.vat_rate),
        vat: Number(cur.vat_krw),
        total: Number(cur.total_krw),
      };

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

  const { error } = await supabase.from("purchase").update(updates).eq("id", id).is("deleted_at", null);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateTransactionPaths("purchases");
  return { ok: true };
}

/**
 * 매입 품목 라인 전체 교체(추가·삭제·수정) — replace_purchase_lines RPC(0093).
 * 홈택스 수집본과 연결된 매입은 라인 합이 계산서 공급가액과 같아야 하고 합계는 고정, 아니면 합계를 라인 합으로 재계산.
 * 결제완료(합계 변경)·재고 이력 가드는 RPC 가 강제. 헤더(입고일·상태·현장 등)는 updatePurchaseHeader 가 따로 처리.
 */
export async function updatePurchaseLines(id: string, linesJson: string): Promise<PurchaseActionResult> {
  const parsed = parsePurchaseLinesJson(linesJson);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const supabase = await createClient();
  const { data: cur } = await supabase.from("purchase").select("status").eq("id", id).maybeSingle();
  if (!cur) return { ok: false, error: "매입을 찾을 수 없습니다." };
  const { error } = await supabase.rpc("replace_purchase_lines", {
    p_purchase_id: id,
    p_lines: toRpcPurchaseLines(parsed.lines, String(cur.status)),
    p_recalc: true,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateTransactionPaths("purchases");
  return { ok: true };
}

export async function markPurchaseReceived(id: string): Promise<PurchaseActionResult> {
  const supabase = await createClient();
  const today = kstToday();

  // header
  const { error: hErr } = await supabase
    .from("purchase")
    .update({ status: "in_stock", delivered_on: today })
    .eq("id", id)
    .is("deleted_at", null);
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
  opts?: { covered?: boolean },
): Promise<PurchaseActionResult> {
  // covered = 다이얼로그가 '이미 나간 출금이 합계를 채움'으로 본 경우 — 통장을 비워 보낸다. RPC 는 그때만 통장 없이 결제완료하고,
  // 그 사이 합계가 늘어 남은 금액이 생겼으면 출금을 만들지 않고 거부한다(아무도 고르지 않은 통장·날짜로 출금하지 않게).
  const covered = opts?.covered === true;
  if (!covered && !bankAccountId) return { ok: false, error: "결제 통장을 선택해주세요." };
  const supabase = await createClient();
  // 이미 나간 출금(지운 매입에서 옮겨 온 결제) — RPC 는 남은 금액만 출금으로 기록한다(0095). 알림 금액용.
  const { paid } = await purchasePaid(supabase, id);
  const { error } = await supabase.rpc("pay_purchase_with_payment", {
    p_purchase_id: id,
    p_bank_account_id: covered ? null : bankAccountId,
    p_paid_on: paidOn || kstToday(),
  });
  if (error) {
    if (covered && error.message.includes("통장을 찾을 수 없습니다")) {
      return { ok: false, error: "그 사이 매입 합계가 바뀌어 남은 금액이 생겼습니다 — 새로고침한 뒤 출금 통장을 골라 다시 해 주세요." };
    }
    return { ok: false, error: friendly(error.message) };
  }
  revalidateTransactionPaths("purchases");
  // 결제 완료 알림(best-effort) — 실제로 처리된 결과(결제 통장·합계)로.
  const { data: p } = await supabase
    .from("purchase")
    .select("doc_no, book, total_krw, pay_bank_account_id, partner:partner(name)")
    .eq("id", id)
    .maybeSingle();
  if (p) {
    const { data: ba } = p.pay_bank_account_id
      ? await supabase.from("bank_account").select("bank_name").eq("id", p.pay_bank_account_id).maybeSingle()
      : { data: null };
    const total = Number(p.total_krw);
    await notifyKakaoWork(
      `💸 결제 완료 · ${BOOK_LABEL[p.book as Book]}\n` +
        `매입처: ${(p.partner as { name?: string } | null)?.name ?? "—"}\n` +
        (paid > 0 && paid >= total
          ? `금액: ${fmtWon(total)} (이미 나간 출금으로 처리)`
          : `금액: ${fmtWon(total - paid)}` + (paid > 0 ? ` (기지급 ${fmtWon(paid)} 제외)` : "")) +
        `\n` +
        `통장: ${(ba as { bank_name?: string } | null)?.bank_name ?? "—"}\n` +
        `문서: ${p.doc_no}\n` +
        adminUrl(`/${p.book}/purchases/${id}`),
    );
  }
  return { ok: true };
}

export type PurchasePaid = { paid: number; lastTxnOn: string | null; lastAccountId: string | null; total: number | null };

/** 이 매입에서 이미 나간 출금(통장 출금, 음수) — 합과 마지막 출금의 날짜·통장. 결제 다이얼로그·알림용. */
async function purchasePaid(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<PurchasePaid> {
  // 지금 합계(화면이 오래됐을 수 있음)와 같은 책 출금 — 결제 RPC(pay_purchase_with_payment)와 같은 기준.
  const { data: pur } = await supabase.from("purchase").select("book, total_krw").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!pur) return { paid: 0, lastTxnOn: null, lastAccountId: null, total: null };
  const { data } = await supabase
    .from("bank_transaction")
    .select("amount_krw, txn_on, bank_account_id")
    .eq("purchase_id", id)
    .eq("book", pur.book)
    .is("deleted_at", null)
    .lt("amount_krw", 0)
    .order("txn_on", { ascending: false })
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Array<{ amount_krw: number; txn_on: string; bank_account_id: string }>;
  return {
    paid: rows.reduce((a, r) => a - Number(r.amount_krw), 0),
    lastTxnOn: rows[0]?.txn_on ?? null,
    lastAccountId: rows[0]?.bank_account_id ?? null,
    total: Number(pur.total_krw),
  };
}

/** 결제 다이얼로그 — 이미 나간 출금(지운 매입에서 옮겨 온 결제)이 있으면 남은 금액만 출금으로 기록됨을 알려 준다. */
export async function getPurchasePaid(id: string): Promise<PurchasePaid> {
  const supabase = await createClient();
  return purchasePaid(supabase, id);
}

/** 세금계산서 수취 토글 — done이면 오늘 날짜, 아니면 null(라이프사이클 단계 표시용 단순 플래그). */
export async function togglePurchaseTaxInvoiceReceived(id: string, done: boolean): Promise<PurchaseActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase")
    .update({ tax_invoice_received_on: done ? kstToday() : null })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateTransactionPaths("purchases");
  return { ok: true };
}
