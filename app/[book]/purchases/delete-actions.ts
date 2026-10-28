"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWork, adminUrl, fmtWon } from "@/lib/kakaowork";
import { revalidateTransactionPaths } from "@/lib/transaction";

/** 옮길 대상 후보 — 같은 책의 살아 있는 다른 매입(이관 매입 제외). */
export type PurchaseDeleteCandidate = {
  id: string;
  doc_no: string;
  ordered_on: string;
  partner_id: string;
  partner_name: string;
  total_krw: number;
  subtotal_krw: number;
  vat_krw: number;
  paid_on: string | null;
  /** 이미 나간 출금(옮겨 온 결제 등) 합. */
  paid_krw: number;
  is_documented: boolean;
  /** 승인번호나 홈택스 수집본 연결이 있음 — 계산서를 더 옮길 수 없다. */
  has_invoice: boolean;
  /** 홈택스 계산서로 자동 생성된 매입(품목 미정 자리표시일 수 있음). */
  from_hometax: boolean;
  same_partner: boolean;
};

/** 매입 삭제 미리보기 — 지우면 같이 처리되는 것(출금·공급자 계산서·재고 lot)과 옮길 대상 후보. */
export type PurchaseDeleteImpact = {
  purchase: {
    id: string;
    doc_no: string;
    book: Book;
    status: string;
    ordered_on: string;
    total_krw: number;
    subtotal_krw: number;
    vat_krw: number;
    partner_id: string;
    partner_name: string;
    paid_on: string | null;
  };
  /** 그 책 manager 이상 — 아니면 지울 수 없다(RPC 도 막는다). */
  canDelete: boolean;
  payments: Array<{ id: string; txn_on: string; amount_krw: number; account: string }>;
  paymentSum: number;
  /**
   * 공급자 계산서 — 홈택스 수집본 연결·승인번호, 또는 승인번호 없이 '계산서 수취'만 표시. 옮기거나 남기기를 골라야 한다.
   * 수집본이 여러 장(당초·수정(−)·재발행 묶음)이면 금액은 순합계, 승인번호는 대표 장(RPC 와 같은 기준).
   */
  invoice: {
    nts: string | null;
    supply_krw: number;
    vat_krw: number;
    total_krw: number;
    write_date: string | null;
    hometaxCount: number;
    /** 승인번호·수집본 없이 수취 표시만 — 지우면 다음 대사가 거래처·금액·날짜로 '지운 매입의 계산서'로 잡는다. */
    receivedOnly: boolean;
    receivedOn: string | null;
  } | null;
  /** 지우면 재고에서 빠지는 품목(lot). */
  lines: { count: number; weightKg: number; summary: string };
  /** 이 매입 lot 을 출고해 간 살아 있는 매출(보이는 것만 — 최종 판정은 RPC). 있으면 지울 수 없다. */
  blockingSales: string[];
  /** 매입 삭제로 지울 수 없는 매입(책 간 이관·어음 연결) — RPC 와 같은 이유를 미리 보여 준다. */
  blockedReason: string | null;
  candidates: PurchaseDeleteCandidate[];
};

export type PurchaseDeleteInput = {
  purchaseId: string;
  payment: "move" | "void" | null;
  targetPurchaseId: string | null;
  invoice: "move" | "keep" | null;
  reason: string;
};

type DeleteRpcResult = {
  doc_no: string;
  book: Book;
  payment: "move" | "void" | "none";
  pay_count: number;
  pay_sum: number;
  excess: number;
  target_id: string | null;
  target_doc_no: string | null;
  target_paid: boolean;
  invoice: "none" | "moved" | "kept";
  invoice_label: string | null;
  vat_adjusted: boolean;
  hometax: number;
  lines: number;
  prices: number;
  detached: number;
};

const CANDIDATE_COLUMNS =
  "id, doc_no, ordered_on, partner_id, total_krw, subtotal_krw, vat_krw, paid_on, is_documented, tax_doc_no, origin, partner:partner(name)";

function friendly(message: string): string {
  if (message.includes("Could not find the function") && message.includes("delete_purchase")) {
    return "매입 삭제 기능(마이그레이션 0095)이 DB에 아직 적용되지 않았습니다.";
  }
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
}

export async function getPurchaseDeleteImpact(
  purchaseId: string,
): Promise<{ ok: true; impact: PurchaseDeleteImpact } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("purchase")
    .select(
      "id, doc_no, book, status, ordered_on, total_krw, subtotal_krw, vat_krw, partner_id, paid_on, tax_doc_no, is_documented, tax_invoice_received_on, purchase_subtype, transfer_id, partner:partner(name)",
    )
    .eq("id", purchaseId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!p) return { ok: false, error: "매입을 찾을 수 없습니다(이미 삭제됐을 수 있습니다)." };
  const book = p.book as Book;
  const candidateBase = () =>
    supabase
      .from("purchase")
      .select(CANDIDATE_COLUMNS)
      .eq("book", book)
      .is("deleted_at", null)
      .eq("purchase_subtype", "external")
      .neq("id", purchaseId);

  const [roleRes, payRes, htRes, linesRes, sameRes, otherRes, noteRes] = await Promise.all([
    supabase.rpc("current_user_has_book_role", { p_book: book, p_min_role: "manager" }),
    // 출금 — RPC(delete_purchase)가 옮기거나 지우는 것과 같은 조건(같은 책·매출/영수증 겸용 아님).
    supabase
      .from("bank_transaction")
      .select("id, txn_on, amount_krw, bank_account:bank_account!bank_transaction_bank_account_id_fkey(code, bank_name)")
      .eq("purchase_id", purchaseId)
      .eq("book", book)
      .is("deleted_at", null)
      .lt("amount_krw", 0)
      .is("sale_id", null)
      .is("receipt_id", null)
      .order("txn_on", { ascending: true }),
    supabase
      .from("hometax_invoice")
      .select("nts_confirm_num, supply_amount, tax_amount, total_amount, write_date")
      .eq("purchase_id", purchaseId)
      .is("deleted_at", null),
    supabase
      .from("purchase_line")
      .select("id, acquired_qty, acquired_unit, actual_weight_kg, theoretical_weight_kg, notes, item:item(name)")
      .eq("purchase_id", purchaseId)
      .is("deleted_at", null),
    candidateBase().eq("partner_id", p.partner_id).order("ordered_on", { ascending: false }).order("doc_no", { ascending: false }).limit(30),
    candidateBase().neq("partner_id", p.partner_id).order("ordered_on", { ascending: false }).order("doc_no", { ascending: false }).limit(30),
    supabase.from("promissory_note").select("id", { count: "exact", head: true }).eq("purchase_id", purchaseId).is("deleted_at", null),
  ]);

  const lineRows = (linesRes.data ?? []) as unknown as Array<{
    id: string;
    acquired_qty: number;
    acquired_unit: string;
    actual_weight_kg: number | null;
    theoretical_weight_kg: number | null;
    notes: string | null;
    item: { name: string } | null;
  }>;
  const rawCandidates = [...(sameRes.data ?? []), ...(otherRes.data ?? [])] as unknown as Array<{
    id: string;
    doc_no: string;
    ordered_on: string;
    partner_id: string;
    total_krw: number;
    subtotal_krw: number;
    vat_krw: number;
    paid_on: string | null;
    is_documented: boolean;
    tax_doc_no: string | null;
    origin: string | null;
    partner: { name: string } | null;
  }>;
  const candidateIds = rawCandidates.map((c) => c.id);
  const lineIds = lineRows.map((l) => l.id);
  const [allocRes, paidRes, candHtRes] = await Promise.all([
    lineIds.length
      ? supabase
          .from("sale_line_allocation")
          .select("sale_line:sale_line(deleted_at, sale:sale(doc_no, status, deleted_at))")
          .in("purchase_line_id", lineIds)
      : Promise.resolve({ data: [] }),
    candidateIds.length
      ? supabase.from("vw_payable").select("purchase_id, paid_krw").in("purchase_id", candidateIds)
      : Promise.resolve({ data: [] }),
    candidateIds.length
      ? supabase.from("hometax_invoice").select("purchase_id").in("purchase_id", candidateIds).is("deleted_at", null)
      : Promise.resolve({ data: [] }),
  ]);
  const paid = new Map(
    ((paidRes.data ?? []) as Array<{ purchase_id: string; paid_krw: number }>).map((r) => [r.purchase_id, Number(r.paid_krw)]),
  );
  const linked = new Set(((candHtRes.data ?? []) as Array<{ purchase_id: string }>).map((r) => r.purchase_id));
  const blockingSales = [
    ...new Set(
      ((allocRes.data ?? []) as unknown as Array<{
        sale_line: { deleted_at: string | null; sale: { doc_no: string; status: string; deleted_at: string | null } | null } | null;
      }>)
        .filter((a) => a.sale_line && !a.sale_line.deleted_at && a.sale_line.sale && !a.sale_line.sale.deleted_at && a.sale_line.sale.status !== "cancelled")
        .map((a) => a.sale_line!.sale!.doc_no),
    ),
  ];

  const payments = ((payRes.data ?? []) as unknown as Array<{
    id: string;
    txn_on: string;
    amount_krw: number;
    bank_account: { code: string; bank_name: string } | null;
  }>).map((d) => ({
    id: d.id,
    txn_on: d.txn_on,
    amount_krw: -Number(d.amount_krw),
    account: d.bank_account ? `${d.bank_account.code} · ${d.bank_account.bank_name}` : "—",
  }));
  const hts = (htRes.data ?? []) as Array<{
    nts_confirm_num: string;
    supply_amount: number;
    tax_amount: number;
    total_amount: number;
    write_date: string;
  }>;
  const receivedOnly = hts.length === 0 && !p.tax_doc_no && book !== "b" && !!p.is_documented && !!p.tax_invoice_received_on;
  const hasInvoice = hts.length > 0 || (book !== "b" && !!p.tax_doc_no) || receivedOnly;
  // 대표 장 — 매입의 증빙 번호와 같은 장(묶음의 재발행 장), 없으면 (+) 최신 장.
  const ntsKey = (v: string | null | undefined) => String(v ?? "").replace(/[^0-9A-Za-z]/g, "").toLowerCase();
  const lead = [...hts].sort(
    (a, b) =>
      Number(ntsKey(b.nts_confirm_num) === ntsKey(p.tax_doc_no)) - Number(ntsKey(a.nts_confirm_num) === ntsKey(p.tax_doc_no)) ||
      Number(Number(b.total_amount) > 0) - Number(Number(a.total_amount) > 0) ||
      String(b.write_date).localeCompare(String(a.write_date)) ||
      String(b.nts_confirm_num).localeCompare(String(a.nts_confirm_num)),
  )[0];
  const htSum = (k: "supply_amount" | "tax_amount" | "total_amount") => hts.reduce((a, h) => a + Number(h[k] ?? 0), 0);
  const weightKg = lineRows.reduce((a, l) => a + Number(l.actual_weight_kg ?? l.theoretical_weight_kg ?? 0), 0);
  const names = [...new Set(lineRows.map((l) => l.item?.name ?? "품목"))];

  return {
    ok: true,
    impact: {
      purchase: {
        id: p.id,
        doc_no: p.doc_no,
        book,
        status: p.status,
        ordered_on: p.ordered_on,
        total_krw: Number(p.total_krw),
        subtotal_krw: Number(p.subtotal_krw),
        vat_krw: Number(p.vat_krw),
        partner_id: p.partner_id,
        partner_name: (p.partner as { name?: string } | null)?.name ?? "—",
        paid_on: p.paid_on,
      },
      canDelete: roleRes.data === true,
      payments,
      paymentSum: payments.reduce((a, d) => a + d.amount_krw, 0),
      invoice: hasInvoice
        ? {
            nts: lead?.nts_confirm_num ?? p.tax_doc_no ?? null,
            supply_krw: hts.length ? htSum("supply_amount") : Number(p.subtotal_krw),
            vat_krw: hts.length ? htSum("tax_amount") : Number(p.vat_krw),
            total_krw: hts.length ? htSum("total_amount") : Number(p.total_krw),
            write_date: lead?.write_date ?? null,
            hometaxCount: hts.length,
            receivedOnly,
            receivedOn: (p.tax_invoice_received_on as string | null) ?? null,
          }
        : null,
      lines: {
        count: lineRows.length,
        weightKg,
        summary: names.slice(0, 3).join(", ") + (names.length > 3 ? ` 외 ${names.length - 3}` : ""),
      },
      blockingSales,
      blockedReason:
        p.purchase_subtype !== "external" || p.transfer_id
          ? "책 간 이관 매입은 매입 삭제로 지울 수 없습니다 — 이관 취소로 처리하세요."
          : (noteRes.count ?? 0) > 0
            ? "어음이 연결된 매입은 삭제할 수 없습니다 — 어음 연결을 먼저 정리하세요."
            : null,
      candidates: rawCandidates.map((c) => ({
        id: c.id,
        doc_no: c.doc_no,
        ordered_on: c.ordered_on,
        partner_id: c.partner_id,
        partner_name: c.partner?.name ?? "—",
        total_krw: Number(c.total_krw),
        subtotal_krw: Number(c.subtotal_krw),
        vat_krw: Number(c.vat_krw),
        paid_on: c.paid_on,
        paid_krw: paid.get(c.id) ?? 0,
        is_documented: c.is_documented,
        has_invoice: !!c.tax_doc_no || linked.has(c.id),
        from_hometax: c.origin === "hometax",
        same_partner: c.partner_id === p.partner_id,
      })),
    },
  };
}

/**
 * 매입 삭제 — delete_purchase RPC(0095) 한 번으로 출금 기록·공급자 계산서·홈택스 연결·재고 lot·시세·메모까지 처리.
 * 돈·계산서가 옮겨지거나 지워지므로 운영방에 알린다(best-effort).
 */
export async function deletePurchaseWithOptions(
  input: PurchaseDeleteInput,
): Promise<{ ok: true; message: string; targetId: string | null } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("purchase")
    .select("doc_no, book, total_krw, partner:partner(name)")
    .eq("id", input.purchaseId)
    .is("deleted_at", null)
    .maybeSingle();

  const reason = input.reason.trim().slice(0, 300);
  const { data, error } = await supabase.rpc("delete_purchase", {
    p_purchase_id: input.purchaseId,
    p_payment: input.payment,
    p_target_purchase_id: input.targetPurchaseId,
    p_invoice: input.invoice,
    p_reason: reason || null,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  const r = data as DeleteRpcResult;

  revalidateTransactionPaths("purchases");
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/inventory`);
    revalidatePath(`/${b}/hometax`);
  }
  if (r.target_id) revalidatePath(`/${r.book}/purchases/${r.target_id}`);

  const paymentText =
    r.payment === "move"
      ? `결제 ${r.pay_count}건 ${fmtWon(r.pay_sum)} → ${r.target_doc_no}${r.target_paid ? " (결제완료 처리)" : ""}` +
        (r.excess > 0 ? ` · 합계보다 ${fmtWon(r.excess)} 많음` : "")
      : r.payment === "void"
        ? `결제 ${r.pay_count}건 ${fmtWon(r.pay_sum)} 기록 지움`
        : null;
  const invoiceText =
    r.invoice === "moved"
      ? `계산서 ${r.invoice_label} → ${r.target_doc_no}${r.vat_adjusted ? " (세액을 계산서 기준으로 맞춤)" : ""}`
      : r.invoice === "kept"
        ? `계산서 ${r.invoice_label} 국세청 기록 유지 — 공급자 수정세금계산서(−)·대체 매입 확인`
        : null;

  if (before) {
    await notifyKakaoWork(
      [
        `🗑 매입 삭제 · ${BOOK_LABEL[before.book as Book]}`,
        `매입처: ${(before.partner as { name?: string } | null)?.name ?? "—"}`,
        `금액: ${fmtWon(before.total_krw as number)}`,
        `문서: ${before.doc_no}`,
        paymentText ? `결제: ${paymentText}` : null,
        invoiceText ? `계산서: ${invoiceText}` : null,
        r.target_doc_no && !paymentText && !invoiceText ? `대상: ${r.target_doc_no}` : null,
        reason ? `사유: ${reason}` : null,
        adminUrl(r.target_id ? `/${r.book}/purchases/${r.target_id}` : `/${r.book}/purchases`),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const parts = [paymentText, invoiceText, r.lines > 0 ? `재고 lot ${r.lines}줄 삭제` : null].filter(Boolean);
  return {
    ok: true,
    message: `[${r.doc_no}] 삭제했습니다${parts.length ? ` — ${parts.join(" · ")}` : ""}`,
    targetId: r.target_id,
  };
}
