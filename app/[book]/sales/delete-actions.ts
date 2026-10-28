"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWork, adminUrl, fmtWon } from "@/lib/kakaowork";
import { revalidateTransactionPaths } from "@/lib/transaction";
import { isTaxInvoiceIssued, type TaxInvoiceState } from "@/lib/tax-invoice";
import { refreshTaxInvoiceStatus } from "./[id]/tax-invoice-actions";

/** 옮길 대상 후보 — 같은 책의 살아 있는(취소 아님) 다른 매출. */
export type SaleDeleteCandidate = {
  id: string;
  doc_no: string;
  ordered_on: string;
  status: string;
  partner_id: string;
  partner_name: string;
  total_krw: number;
  subtotal_krw: number;
  vat_krw: number;
  received_krw: number;
  is_documented: boolean;
  /** 발행 기록이 있거나 '발행 완료'로 표시됨 — 계산서를 더 옮길 수 없다. */
  has_invoice: boolean;
  same_partner: boolean;
};

/** 매출 삭제 미리보기 — 지우면 같이 처리되는 것(입금·계산서·홈택스·재고)과 옮길 대상 후보. */
export type SaleDeleteImpact = {
  sale: {
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
    tax_invoice_issued_on: string | null;
    source_quote_doc_no: string | null;
  };
  /** 그 책 manager 이상 — 아니면 지울 수 없다(RPC 도 막는다). */
  canDelete: boolean;
  deposits: Array<{ id: string; txn_on: string; amount_krw: number; account: string }>;
  depositSum: number;
  invoice: {
    provider: string;
    state: TaxInvoiceState;
    nts_confirm_num: string | null;
    mgt_key: string;
    write_date: string;
    supply_krw: number;
    vat_krw: number;
    total_krw: number;
    /** 발행됐거나 발행 중 — 옮길지·국세청 기록으로 남길지 골라야 한다. 아니면(작성·실패) 삭제 때 정리된다. */
    needsChoice: boolean;
  } | null;
  /** 발행 기록 없이 '계산서 발행 완료'로만 표시된 매출(시스템 밖 발행) — 발행된 계산서처럼 옮기거나 남기기를 골라야 한다. */
  externalIssued: boolean;
  hometaxCount: number;
  allocationCount: number;
  candidates: SaleDeleteCandidate[];
};

export type SaleDeleteInput = {
  saleId: string;
  payment: "move" | "void" | null;
  targetSaleId: string | null;
  invoice: "move" | "keep" | null;
  reason: string;
  /** 시스템 밖 발행분을 남길 때 국세청 승인번호(알면). */
  nts: string;
};

type DeleteRpcResult = {
  doc_no: string;
  book: Book;
  payment: "move" | "void" | "none";
  deposit_count: number;
  deposit_sum: number;
  excess: number;
  target_id: string | null;
  target_doc_no: string | null;
  target_settled: boolean;
  invoice: "none" | "cleaned" | "moved" | "kept";
  invoice_label: string | null;
  hometax: number;
  allocations: number;
  detached: number;
  quote_reset: boolean;
};

const CANDIDATE_COLUMNS =
  "id, doc_no, ordered_on, status, partner_id, total_krw, subtotal_krw, vat_krw, is_documented, tax_invoice_issued_on, partner:partner(name)";

function friendly(message: string): string {
  if (message.includes("Could not find the function") && message.includes("delete_sale")) {
    return "매출 삭제 기능(마이그레이션 0094)이 DB에 아직 적용되지 않았습니다.";
  }
  if (message.includes("uq_tax_invoice_nts_active")) return "같은 승인번호의 계산서 기록이 이미 다른 매출에 있습니다.";
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
}

export async function getSaleDeleteImpact(
  saleId: string,
): Promise<{ ok: true; impact: SaleDeleteImpact } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: s } = await supabase
    .from("sale")
    .select(
      "id, doc_no, book, status, ordered_on, total_krw, subtotal_krw, vat_krw, partner_id, tax_invoice_issued_on, source_quote_id, partner:partner(name)",
    )
    .eq("id", saleId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!s) return { ok: false, error: "매출을 찾을 수 없습니다(이미 삭제됐을 수 있습니다)." };
  const book = s.book as Book;

  // 팝빌 발행 직후엔 승인번호가 비어 있다 — 지운 뒤엔 상세(상태 조회)가 없으니 지금 받아 둔다(홈택스 대사가 번호로 알아본다).
  const { data: pending } = await supabase
    .from("tax_invoice")
    .select("id")
    .eq("sale_id", saleId)
    .eq("provider", "popbill")
    .is("deleted_at", null)
    .is("nts_confirm_num", null)
    .in("state", ["issuing", "issued", "nts_sent"])
    .maybeSingle();
  if (pending) await refreshTaxInvoiceStatus(saleId).catch(() => null);
  const candidateBase = () =>
    supabase
      .from("sale")
      .select(CANDIDATE_COLUMNS)
      .eq("book", book)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .neq("id", saleId);

  const [roleRes, depRes, invRes, htRes, linesRes, quoteRes, sameRes, otherRes] = await Promise.all([
    supabase.rpc("current_user_has_book_role", { p_book: book, p_min_role: "manager" }),
    // 입금 — RPC(delete_sale)가 옮기거나 취소하는 것과 같은 조건(같은 책·매입/영수증 겸용 아님).
    supabase
      .from("bank_transaction")
      .select("id, txn_on, amount_krw, bank_account:bank_account!bank_transaction_bank_account_id_fkey(code, bank_name)")
      .eq("sale_id", saleId)
      .eq("book", book)
      .is("deleted_at", null)
      .gt("amount_krw", 0)
      .is("purchase_id", null)
      .is("receipt_id", null)
      .order("txn_on", { ascending: true }),
    supabase
      .from("tax_invoice")
      .select("provider, state, nts_confirm_num, mgt_key, write_date, supply_krw, vat_krw, total_krw")
      .eq("sale_id", saleId)
      .is("deleted_at", null)
      .neq("state", "cancelled")
      .maybeSingle(),
    supabase.from("hometax_invoice").select("id", { count: "exact", head: true }).eq("sale_id", saleId).is("deleted_at", null),
    supabase.from("sale_line").select("id").eq("sale_id", saleId),
    s.source_quote_id
      ? supabase.from("quote").select("doc_no").eq("id", s.source_quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    candidateBase().eq("partner_id", s.partner_id).order("ordered_on", { ascending: false }).order("doc_no", { ascending: false }).limit(30),
    candidateBase().neq("partner_id", s.partner_id).order("ordered_on", { ascending: false }).order("doc_no", { ascending: false }).limit(30),
  ]);

  const lineIds = (linesRes.data ?? []).map((l) => l.id as string);
  const rawCandidates = [...(sameRes.data ?? []), ...(otherRes.data ?? [])] as unknown as Array<
    Omit<SaleDeleteCandidate, "partner_name" | "received_krw" | "has_invoice" | "same_partner"> & {
      tax_invoice_issued_on: string | null;
      partner: { name: string } | null;
    }
  >;
  const candidateIds = rawCandidates.map((c) => c.id);
  const [allocRes, recvRes, candInvRes] = await Promise.all([
    lineIds.length
      ? supabase.from("sale_line_allocation").select("id", { count: "exact", head: true }).in("sale_line_id", lineIds)
      : Promise.resolve({ count: 0 }),
    candidateIds.length
      ? supabase.from("vw_receivable").select("sale_id, received_krw").in("sale_id", candidateIds)
      : Promise.resolve({ data: [] }),
    candidateIds.length
      ? supabase.from("tax_invoice").select("sale_id").in("sale_id", candidateIds).is("deleted_at", null).neq("state", "cancelled")
      : Promise.resolve({ data: [] }),
  ]);
  const received = new Map(
    ((recvRes.data ?? []) as Array<{ sale_id: string; received_krw: number }>).map((r) => [r.sale_id, Number(r.received_krw)]),
  );
  const invoiced = new Set(((candInvRes.data ?? []) as Array<{ sale_id: string }>).map((r) => r.sale_id));
  for (const c of rawCandidates) if (c.tax_invoice_issued_on) invoiced.add(c.id);

  const deposits = ((depRes.data ?? []) as unknown as Array<{
    id: string;
    txn_on: string;
    amount_krw: number;
    bank_account: { code: string; bank_name: string } | null;
  }>).map((d) => ({
    id: d.id,
    txn_on: d.txn_on,
    amount_krw: Number(d.amount_krw),
    account: d.bank_account ? `${d.bank_account.code} · ${d.bank_account.bank_name}` : "—",
  }));
  const inv = invRes.data as
    | { provider: string; state: TaxInvoiceState; nts_confirm_num: string | null; mgt_key: string; write_date: string; supply_krw: number; vat_krw: number; total_krw: number }
    | null;

  return {
    ok: true,
    impact: {
      sale: {
        id: s.id,
        doc_no: s.doc_no,
        book,
        status: s.status,
        ordered_on: s.ordered_on,
        total_krw: Number(s.total_krw),
        subtotal_krw: Number(s.subtotal_krw),
        vat_krw: Number(s.vat_krw),
        partner_id: s.partner_id,
        partner_name: (s.partner as { name?: string } | null)?.name ?? "—",
        tax_invoice_issued_on: s.tax_invoice_issued_on,
        source_quote_doc_no: (quoteRes.data as { doc_no: string } | null)?.doc_no ?? null,
      },
      canDelete: roleRes.data === true,
      deposits,
      depositSum: deposits.reduce((a, d) => a + d.amount_krw, 0),
      invoice: inv
        ? {
            ...inv,
            supply_krw: Number(inv.supply_krw),
            vat_krw: Number(inv.vat_krw),
            total_krw: Number(inv.total_krw),
            needsChoice: inv.state === "issuing" || isTaxInvoiceIssued(inv.state),
          }
        : null,
      externalIssued: !inv && !!s.tax_invoice_issued_on && book !== "b",
      hometaxCount: htRes.count ?? 0,
      allocationCount: allocRes.count ?? 0,
      candidates: rawCandidates.map((c) => ({
        id: c.id,
        doc_no: c.doc_no,
        ordered_on: c.ordered_on,
        status: c.status,
        partner_id: c.partner_id,
        partner_name: c.partner?.name ?? "—",
        total_krw: Number(c.total_krw),
        subtotal_krw: Number(c.subtotal_krw),
        vat_krw: Number(c.vat_krw),
        received_krw: received.get(c.id) ?? 0,
        is_documented: c.is_documented,
        has_invoice: invoiced.has(c.id),
        same_partner: c.partner_id === s.partner_id,
      })),
    },
  };
}

/**
 * 매출 삭제 — delete_sale RPC(0094) 한 번으로 수금 기록·계산서·홈택스 연결·재고 할당·메모까지 처리.
 * 돈·계산서가 옮겨지거나 취소되므로 운영방에 알린다(best-effort).
 */
export async function deleteSaleWithOptions(
  input: SaleDeleteInput,
): Promise<{ ok: true; message: string; targetId: string | null } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("sale")
    .select("doc_no, book, total_krw, partner:partner(name)")
    .eq("id", input.saleId)
    .is("deleted_at", null)
    .maybeSingle();

  const reason = input.reason.trim().slice(0, 300);
  const { data, error } = await supabase.rpc("delete_sale", {
    p_sale_id: input.saleId,
    p_payment: input.payment,
    p_target_sale_id: input.targetSaleId,
    p_invoice: input.invoice,
    p_reason: reason || null,
    p_nts: input.nts.trim() || null,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  const r = data as DeleteRpcResult;

  revalidateTransactionPaths("sales");
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/tax-invoices`);
    revalidatePath(`/${b}/hometax`);
    revalidatePath(`/${b}/inventory`);
  }
  if (r.target_id) revalidatePath(`/${r.book}/sales/${r.target_id}`);

  const paymentText =
    r.payment === "move"
      ? `수금 ${r.deposit_count}건 ${fmtWon(r.deposit_sum)} → ${r.target_doc_no}${r.target_settled ? " (수금완료 처리)" : ""}` +
        (r.excess > 0 ? ` · 합계보다 ${fmtWon(r.excess)} 많음` : "")
      : r.payment === "void"
        ? `수금 ${r.deposit_count}건 ${fmtWon(r.deposit_sum)} 기록 지움`
        : null;
  const invoiceText =
    r.invoice === "moved"
      ? `계산서 ${r.invoice_label} → ${r.target_doc_no}`
      : r.invoice === "kept"
        ? `계산서 ${r.invoice_label} 국세청 기록 유지 — 수정세금계산서(−)·발행취소 확인`
        : null;

  if (before) {
    await notifyKakaoWork(
      [
        `🗑 매출 삭제 · ${BOOK_LABEL[before.book as Book]}`,
        `거래처: ${(before.partner as { name?: string } | null)?.name ?? "—"}`,
        `금액: ${fmtWon(before.total_krw as number)}`,
        `문서: ${before.doc_no}`,
        paymentText ? `수금: ${paymentText}` : null,
        invoiceText ? `계산서: ${invoiceText}` : null,
        r.target_doc_no && !paymentText && !invoiceText ? `대상: ${r.target_doc_no}` : null,
        reason ? `사유: ${reason}` : null,
        adminUrl(r.target_id ? `/${r.book}/sales/${r.target_id}` : `/${r.book}/sales`),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const parts = [
    paymentText,
    invoiceText,
    r.allocations > 0 ? `재고 출고 ${r.allocations}건 해제` : null,
    r.quote_reset ? "견적을 발송 상태로 되돌림" : null,
  ].filter(Boolean);
  return {
    ok: true,
    message: `[${r.doc_no}] 삭제했습니다${parts.length ? ` — ${parts.join(" · ")}` : ""}`,
    targetId: r.target_id,
  };
}
