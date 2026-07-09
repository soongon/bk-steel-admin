"use server";

import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWork, adminUrl, fmtWon } from "@/lib/kakaowork";
import { resolveSiteId } from "@/lib/site";
import { resolvePartnerId } from "@/lib/partner";
import { computeVat, revalidateTransactionPaths } from "@/lib/transaction";

export type SaleActionResult = { ok: true } | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("sale_doc_no_key")) return "이미 사용 중인 문서번호입니다.";
  if (message.includes("chk_bk_documented_sale")) return "법인 매출은 자료거래(세금계산서)가 필수입니다.";
  if (message.includes("chk_b_undocumented_sale")) return "B계좌 매출은 무자료만 가능합니다.";
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
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

type SaleLineInput = {
  item_id: string;
  unit: "ton" | "kg" | "ea" | "piece" | "bundle";
  qty: number;
  unit_price_krw: number;
  weight_kg: number | null;
  manual_amount: number | null; // 금액 직접입력(운송비 포함 등) 시 라인 총액
  display_name: string | null; // 철제 직접입력 품목명(공용 STEEL_CUSTOM 라벨)
  spec_text: string | null; // 철제 직접입력 규격
};
type CreateInput = {
  book: Book;
  doc_no?: string;
  partner_id?: string; // 미등록 거래처면 partner_name 으로 자동 생성(resolvePartnerId)
  partner_name?: string | null;
  site_id?: string | null;
  site_name?: string | null;
  ordered_on: string;
  delivered_on?: string | null;
  lines: SaleLineInput[];
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
  const book = str("book") as Book;
  if (!book || !["bk", "sl", "b"].includes(book)) return { error: "책을 선택해주세요." };
  const partner_id = str("partner_id");
  const partner_name = str("partner_name");
  if (!partner_id && !partner_name) return { error: "거래처를 입력해주세요." };
  const ordered_on = str("ordered_on");
  if (!ordered_on) return { error: "주문일을 입력해주세요." };

  // 품목 라인 — 폼이 JSON 배열로 전송(여러 품목)
  let lines: SaleLineInput[];
  try {
    const raw: unknown = JSON.parse(str("lines") || "[]");
    if (!Array.isArray(raw) || raw.length === 0) {
      return { error: "품목을 1개 이상 추가해주세요." };
    }
    lines = raw.map((l) => {
      const o = l as Record<string, unknown>;
      const w = o.weight_kg;
      return {
        item_id: String(o.item_id ?? ""),
        unit: String(o.unit ?? "") as SaleLineInput["unit"],
        qty: Number(o.qty) || 0,
        unit_price_krw: Number(o.unit_price_krw) || 0,
        weight_kg: w != null && w !== "" ? Number(w) : null,
        manual_amount: o.manual_amount != null && o.manual_amount !== "" ? Number(o.manual_amount) : null,
        display_name: typeof o.display_name === "string" && o.display_name.trim() ? o.display_name.trim() : null,
        spec_text: typeof o.spec_text === "string" && o.spec_text.trim() ? o.spec_text.trim() : null,
      };
    });
  } catch {
    return { error: "품목 데이터를 읽지 못했습니다." };
  }
  for (const l of lines) {
    if (!l.item_id) return { error: "품목을 선택해주세요." };
    if (!l.unit) return { error: "단위를 선택해주세요." };
    if (l.qty <= 0) return { error: "수량을 입력해주세요." };
    // 금액 직접입력(manual_amount>0)이면 단가 없이도 등록 — 그 총액을 라인 금액으로 저장.
    const manual = l.manual_amount != null && l.manual_amount > 0;
    if (!manual && l.unit_price_krw <= 0) return { error: "단가를 입력하거나 금액 직접입력을 사용하세요." };
  }

  const is_documented = str("is_documented") === "true";
  const tax_doc_type = (str("tax_doc_type") || (book === "b" ? "none" : "tax_invoice_electronic")) as CreateInput["tax_doc_type"];
  // 등록은 '납품 전'(주문/확정)만 — 납품완료·수금완료는 라이프사이클 버튼/다이얼로그로만 진행.
  const statusRaw = str("status") || "reserved";
  const status = (["reserved", "confirmed"].includes(statusRaw) ? statusRaw : "reserved") as CreateInput["status"];

  return {
    book,
    doc_no: str("doc_no") || undefined,
    partner_id: partner_id || undefined,
    partner_name: partner_name || null,
    site_id: str("site_id") || null,
    site_name: str("site_name") || null,
    ordered_on,
    delivered_on: str("delivered_on") || null,
    lines,
    status,
    is_documented,
    tax_doc_type,
    payment_due_on: str("payment_due_on") || null,
    notes: str("notes") || null,
  };
}

export async function createSale(formData: FormData): Promise<SaleActionResult> {
  const parsed = readCreateInput(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();

  const docNo = parsed.doc_no ?? (await generateDocNo(parsed.ordered_on));
  const resolvedSiteId = await resolveSiteId(supabase, parsed.site_id ?? null, parsed.site_name ?? null);
  // 거래처: id 없으면 이름으로 자동 생성/조회(현장과 동일 정책).
  const resolvedPartnerId = await resolvePartnerId(supabase, parsed.partner_id ?? null, parsed.partner_name ?? null);
  if (!resolvedPartnerId) return { ok: false, error: "거래처를 확인해주세요." };

  // 라인별 공급가(철근=원/kg×이론중량, 비철근=단가×수량) → 헤더 합계.
  // 금액 직접입력(운송비 포함 등)이면 그 총액을 공급가로, 단가는 총액÷(중량 or 수량) 역산 저장.
  const lines = parsed.lines.map((l) => {
    const manual = l.manual_amount != null && l.manual_amount > 0;
    const lineSubtotal = manual
      ? Math.round(l.manual_amount!)
      : l.weight_kg
        ? Math.round(l.unit_price_krw * l.weight_kg)
        : Math.round(l.unit_price_krw * l.qty);
    // 금액 직접입력이면 단가는 비워둔다(0) — 역산하지 않고 명세표에 '-' 로 표시.
    const unitPrice = manual ? 0 : l.unit_price_krw;
    return {
      item_id: l.item_id,
      unit: l.unit,
      qty: l.qty,
      unit_price_krw: unitPrice,
      weight_kg: l.weight_kg,
      line_subtotal_krw: lineSubtotal,
      display_name: l.display_name,
      spec_text: l.spec_text,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.line_subtotal_krw, 0);
  const documented = parsed.is_documented;
  const { vatType, vatRate, vat, total } = computeVat(documented, parsed.tax_doc_type, subtotal);

  // 헤더 + 라인 N개 한 트랜잭션(RPC) — 분리 insert 시 라인 실패하면 헤더만 남던 문제 방지.
  const { error: rpcErr } = await supabase.rpc("create_sale_with_lines", {
    p_sale: {
      book: parsed.book,
      doc_no: docNo,
      partner_id: resolvedPartnerId,
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
    p_lines: lines,
  });
  if (rpcErr) return { ok: false, error: friendly(rpcErr.message) };

  revalidateTransactionPaths("sales");
  await notifyKakaoWork(
    `🟢 신규 매출 · ${BOOK_LABEL[parsed.book as Book]}\n` +
      `거래처: ${parsed.partner_name ?? "—"}\n` +
      `금액: ${fmtWon(total)} ${documented ? "(자료)" : "(무자료)"}\n` +
      `문서: ${docNo}\n` +
      adminUrl(`/${parsed.book}/sales?doc=${docNo}`),
  );
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

  // 현재 상태·공급가·책·수금 — 전이 검증 + 부가세 재계산 + 책 변경 가드
  const { data: cur } = await supabase
    .from("sale")
    .select("status, subtotal_krw, book, settled_on")
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

  // 책 변경 — 수금완료·세금계산서 발행된 매출은 통장·공급자 정합 때문에 불가.
  const newBook = str("book");
  const bookChanged = !!newBook && !!cur && newBook !== cur.book;
  if (bookChanged) {
    if (cur!.settled_on || cur!.status === "settled") {
      return { ok: false, error: "수금 완료된 매출은 책을 변경할 수 없습니다(통장 정합 유지)." };
    }
    const { data: ti } = await supabase
      .from("tax_invoice")
      .select("id")
      .eq("sale_id", id)
      .is("deleted_at", null)
      .neq("state", "cancelled")
      .maybeSingle();
    if (ti) return { ok: false, error: "세금계산서가 발행된 매출은 책을 변경할 수 없습니다(공급자 정합)." };
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
    ...(bookChanged ? { book: newBook } : {}),
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
  revalidateTransactionPaths("sales");
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
  revalidateTransactionPaths("sales");
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
  revalidateTransactionPaths("sales");
  // 수금 완료 알림(best-effort)
  const { data: s } = await supabase
    .from("sale")
    .select("doc_no, book, total_krw, partner:partner(name)")
    .eq("id", id)
    .maybeSingle();
  const { data: ba } = await supabase
    .from("bank_account")
    .select("bank_name")
    .eq("id", bankAccountId)
    .maybeSingle();
  if (s) {
    await notifyKakaoWork(
      `💰 수금 완료 · ${BOOK_LABEL[s.book as Book]}\n` +
        `거래처: ${(s.partner as { name?: string } | null)?.name ?? "—"}\n` +
        `금액: ${fmtWon(s.total_krw as number)}\n` +
        `통장: ${(ba as { bank_name?: string } | null)?.bank_name ?? "—"}\n` +
        `문서: ${s.doc_no}\n` +
        adminUrl(`/${s.book}/sales/${id}`),
    );
  }
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
  revalidateTransactionPaths("sales");
  // 매출 취소 알림(best-effort)
  const { data: s } = await supabase
    .from("sale")
    .select("doc_no, book, total_krw, partner:partner(name)")
    .eq("id", id)
    .maybeSingle();
  if (s) {
    await notifyKakaoWork(
      `🔴 매출 취소 · ${BOOK_LABEL[s.book as Book]}\n` +
        `거래처: ${(s.partner as { name?: string } | null)?.name ?? "—"}\n` +
        `금액: ${fmtWon(s.total_krw as number)}\n` +
        `문서: ${s.doc_no}\n` +
        adminUrl(`/${s.book}/sales/${id}`),
    );
  }
  return { ok: true };
}

export async function deleteSale(id: string): Promise<SaleActionResult> {
  const supabase = await createClient();
  // RPC가 manager 권한을 강제(soft-delete가 staff UPDATE 정책으로 우회되던 문제 차단).
  const { error } = await supabase.rpc("soft_delete_sale", { p_id: id });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateTransactionPaths("sales");
  return { ok: true };
}

/** 거래명세표 송부 토글 — done이면 오늘 날짜, 아니면 null(라이프사이클 단계 표시용 단순 플래그). */
export async function toggleSaleStatementSent(id: string, done: boolean): Promise<SaleActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sale")
    .update({ statement_sent_on: done ? new Date().toISOString().slice(0, 10) : null })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateTransactionPaths("sales");
  return { ok: true };
}

/** 세금계산서 발행 토글 — done이면 오늘 날짜, 아니면 null. */
export async function toggleSaleTaxInvoiceIssued(id: string, done: boolean): Promise<SaleActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sale")
    .update({ tax_invoice_issued_on: done ? new Date().toISOString().slice(0, 10) : null })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateTransactionPaths("sales");
  return { ok: true };
}

/**
 * 거래명세표 '품목명' 라벨 오버라이드 — 라인별 display_name 갱신(표시 전용).
 * 보통 '철근'이지만 거래처가 '철근(현대철강)' 식 표기를 원할 때 사용. 빈 값이면 기본으로 복귀(null).
 * 수량·단가·금액·상태 불변이라 표시명만 다루는 set_sale_line_display_names RPC 경유.
 */
export async function updateSaleLineDisplayNames(
  saleId: string,
  updates: { id: string; display_name: string | null }[],
): Promise<SaleActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sale_line_display_names", {
    p_sale_id: saleId,
    p_updates: updates,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateTransactionPaths("sales");
  return { ok: true };
}
