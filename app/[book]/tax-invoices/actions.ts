"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { refreshTaxInvoiceStatus } from "../sales/[id]/tax-invoice-actions";

/**
 * 지운 매출에 남긴 세금계산서 정리 — 팝빌·홈택스에서 수정세금계산서(−)를 발행했거나 발행취소한 뒤 표시한다.
 * close_deleted_sale_invoice RPC(0094): 그 책 manager 이상, 매출이 지워진 계산서만.
 * modified = 원본은 국세청에 남으니 합계 유지 · cancelled = 발행취소라 합계에서 빠짐. 같은 승인번호의 홈택스 수집본은 '무시'.
 */
export async function closeDeletedSaleInvoice(
  invoiceId: string,
  resolution: "modified" | "cancelled",
  note: string,
  nts: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_deleted_sale_invoice", {
    p_invoice_id: invoiceId,
    p_resolution: resolution,
    p_note: note.trim().slice(0, 300) || null,
    p_nts: nts.trim() || null,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("Could not find the function")
        ? "정리 기능(마이그레이션 0094)이 DB에 아직 적용되지 않았습니다."
        : error.message.includes("uq_tax_invoice_nts_active")
          ? "같은 승인번호의 계산서 기록이 이미 다른 매출에 있습니다."
          : error.message,
    };
  }
  for (const b of ["all", "bk", "sl"]) {
    revalidatePath(`/${b}/tax-invoices`);
    revalidatePath(`/${b}/hometax`);
  }
  return { ok: true };
}

/** 지운 매출에 남긴 팝빌 계산서의 승인번호·상태를 다시 받아 온다(발행 직후 지워 승인번호가 비어 있을 때). */
export async function refreshDeletedSaleInvoice(saleId: string): Promise<{ ok: true; nts: string | null } | { ok: false; error: string }> {
  const r = await refreshTaxInvoiceStatus(saleId);
  if (!r.ok) return { ok: false, error: r.error };
  for (const b of ["all", "bk", "sl"]) revalidatePath(`/${b}/tax-invoices`);
  return { ok: true, nts: r.ntsConfirmNum ?? null };
}
