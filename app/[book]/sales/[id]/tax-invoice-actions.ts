"use server";

import { type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { notifyKakaoWork, adminUrl, fmtWon } from "@/lib/kakaowork";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { revalidateTransactionPaths } from "@/lib/transaction";
import { digitsOnly } from "@/lib/format";
import { electronicIssueBlockReason } from "@/lib/tax-invoice";
import { getEtaxProvider } from "@/lib/etax";
import {
  SALE_ETAX_SELECT,
  buildSaleEtaxInput,
  buildSaleEtaxLines,
  summarizeEtaxLines,
} from "@/lib/etax/sale-payload";

export type TaxInvoiceActionResult =
  | { ok: true; state?: string; ntsConfirmNum?: string | null }
  | { ok: false; error: string };

/** 발행 payload 구성에 필요한 매출+거래처+라인. */
async function loadSale(supabase: SupabaseClient, saleId: string) {
  const { data } = await supabase
    .from("sale")
    .select(SALE_ETAX_SELECT)
    .eq("id", saleId)
    .is("deleted_at", null)
    .maybeSingle();
  return data as Record<string, any> | null;
}

/** 미취소 활성 세금계산서(있으면 중복발행 차단·취소·상태조회 대상). */
async function activeInvoice(supabase: SupabaseClient, saleId: string) {
  const { data } = await supabase
    .from("tax_invoice")
    .select("id, book, mgt_key, state, provider, supplier")
    .eq("sale_id", saleId)
    .is("deleted_at", null)
    .neq("state", "cancelled")
    .maybeSingle();
  return data as Record<string, any> | null;
}

/**
 * 전자세금계산서 발행 — ASP(팝빌) 실연동. 가드(book≠B·자료·전자·거래처 사업자번호) 후
 * 공급자(회사)·공급받는자(거래처)·라인으로 payload 구성 → provider.issue → record_sale_tax_invoice RPC.
 * 거래처 사업자번호/이메일/대표자가 비면 opts 로 입력받아 partner 보강.
 */
export async function issueSaleTaxInvoice(
  saleId: string,
  opts: {
    writeDate?: string;
    purpose?: "charge" | "receipt";
    remark?: string;
    buyerBusinessNo?: string;
    buyerEmail?: string;
    buyerCeoName?: string;
  } = {},
): Promise<TaxInvoiceActionResult> {
  const supabase = await createClient();
  const sale = await loadSale(supabase, saleId);
  if (!sale) return { ok: false, error: "매출을 찾을 수 없습니다." };
  const book = sale.book as Book;
  const partner = sale.partner as Record<string, any> | null;

  const buyerBizNo = digitsOnly(opts.buyerBusinessNo ?? partner?.business_no ?? "");
  const buyerEmail = opts.buyerEmail?.trim() || partner?.email || null;
  const buyerCeo = opts.buyerCeoName?.trim() || partner?.representative || null;

  const existing = await activeInvoice(supabase, saleId);
  const block = electronicIssueBlockReason({
    book,
    isDocumented: sale.is_documented,
    taxDocType: sale.tax_doc_type,
    buyerBusinessNo: buyerBizNo || null,
    alreadyIssued: !!existing,
  });
  if (block) return { ok: false, error: block };

  // 거래처 사업자정보 보강(입력값 있을 때만 partner 갱신 — 마스터 보강, 금액 무관)
  if (partner?.id && (opts.buyerBusinessNo || opts.buyerEmail || opts.buyerCeoName)) {
    await supabase
      .from("partner")
      .update({
        business_no: buyerBizNo || partner.business_no,
        email: buyerEmail ?? partner.email,
        representative: buyerCeo ?? partner.representative,
      })
      .eq("id", partner.id);
  }

  const company = await fetchCompanyProfile(supabase, book);
  if (!company?.business_no) {
    return { ok: false, error: "공급자(회사) 사업자번호가 없습니다 — 설정 → 회사 정보를 먼저 등록하세요." };
  }

  const writeDateIso = opts.writeDate || String(sale.ordered_on);
  const input = buildSaleEtaxInput(sale, company, {
    writeDateIso,
    purpose: opts.purpose ?? "charge",
    remark: opts.remark?.trim() || null,
    buyerBizNo,
    buyerEmail,
    buyerCeo,
  });

  const provider = getEtaxProvider();
  let result;
  try {
    result = await provider.issue(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "세금계산서 발행 실패" };
  }

  const { error } = await supabase.rpc("record_sale_tax_invoice", {
    p_sale_id: saleId,
    p_invoice: {
      provider: provider.name,
      mgt_key: result.mgtKey,
      nts_confirm_num: result.ntsConfirmNum,
      state: result.state,
      purpose: input.purpose,
      write_date: writeDateIso,
      supplier: input.supplier,
      buyer: input.buyer,
      lines: input.lines,
      supply_krw: input.supplyCostTotal,
      vat_krw: input.taxTotal,
      total_krw: input.totalAmount,
      item_summary: input.itemSummary,
      remark: input.remark,
      asp_response: result.raw,
    },
  });
  if (error) return { ok: false, error: error.message };
  revalidateTransactionPaths("sales");
  await notifyKakaoWork(
    `🧾 세금계산서 발행 · ${BOOK_LABEL[book]}\n` +
      `거래처: ${partner?.name ?? "—"}\n` +
      `금액: ${fmtWon(input.totalAmount)}\n` +
      `승인번호: ${result.ntsConfirmNum ?? "(국세청 전송 대기)"}\n` +
      adminUrl(`/${book}/sales/${saleId}`),
  );
  return { ok: true, state: result.state, ntsConfirmNum: result.ntsConfirmNum };
}

/** 발행 취소 — ASP cancelIssue(수기는 생략) 후 cancel_sale_tax_invoice RPC. */
export async function cancelSaleTaxInvoice(saleId: string, reason: string): Promise<TaxInvoiceActionResult> {
  const supabase = await createClient();
  const inv = await activeInvoice(supabase, saleId);
  if (!inv) return { ok: false, error: "취소할 세금계산서가 없습니다." };

  const corpNum = digitsOnly(String((inv.supplier as Record<string, any>)?.corpNum ?? ""));
  if (inv.provider !== "manual") {
    try {
      await getEtaxProvider().cancel(corpNum, inv.mgt_key, reason);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "발행취소 실패" };
    }
  }
  const { error } = await supabase.rpc("cancel_sale_tax_invoice", { p_sale_id: saleId, p_reason: reason });
  if (error) return { ok: false, error: error.message };
  revalidateTransactionPaths("sales");
  return { ok: true };
}

/** ASP 상태조회 → update_tax_invoice_state RPC(국세청 승인번호 동기화). */
export async function refreshTaxInvoiceStatus(saleId: string): Promise<TaxInvoiceActionResult> {
  const supabase = await createClient();
  const inv = await activeInvoice(supabase, saleId);
  if (!inv) return { ok: false, error: "세금계산서가 없습니다." };
  if (inv.provider === "manual") return { ok: true }; // 수기는 상태조회 대상 아님

  const corpNum = digitsOnly(String((inv.supplier as Record<string, any>)?.corpNum ?? ""));
  let status;
  try {
    status = await getEtaxProvider().getStatus(corpNum, inv.mgt_key);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "상태 조회 실패" };
  }
  const { error } = await supabase.rpc("update_tax_invoice_state", {
    p_sale_id: saleId,
    p_state: status.state,
    p_nts: status.ntsConfirmNum ?? "",
  });
  if (error) return { ok: false, error: error.message };
  revalidateTransactionPaths("sales");
  return { ok: true, state: status.state, ntsConfirmNum: status.ntsConfirmNum };
}

/** 국세청/ASP 원본 PDF·인쇄 URL(법적 원본). */
export async function getTaxInvoicePrintUrl(
  saleId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const inv = await activeInvoice(supabase, saleId);
  if (!inv) return { ok: false, error: "세금계산서가 없습니다." };
  if (inv.provider === "manual") return { ok: false, error: "수기 기록 건은 원본 PDF가 없습니다." };

  const corpNum = digitsOnly(String((inv.supplier as Record<string, any>)?.corpNum ?? ""));
  try {
    const url = await getEtaxProvider().getPrintUrl(corpNum, inv.mgt_key);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "PDF 조회 실패" };
  }
}

/** 종이세금계산서·면세계산서 수기 기록(ASP 미경유) — 번호·발행일만 기록. */
export async function recordManualTaxInvoice(
  saleId: string,
  opts: { taxDocNo: string; writeDate?: string },
): Promise<TaxInvoiceActionResult> {
  const supabase = await createClient();
  const sale = await loadSale(supabase, saleId);
  if (!sale) return { ok: false, error: "매출을 찾을 수 없습니다." };
  const book = sale.book as Book;
  if (book === "b" || !sale.is_documented) return { ok: false, error: "세금계산서 대상이 아닙니다." };
  if (!opts.taxDocNo?.trim()) return { ok: false, error: "세금계산서 번호를 입력하세요." };
  if (await activeInvoice(supabase, saleId)) return { ok: false, error: "이미 기록된 세금계산서가 있습니다." };

  const company = await fetchCompanyProfile(supabase, book);
  const partner = sale.partner as Record<string, any> | null;
  const writeDateIso = opts.writeDate || String(sale.ordered_on);
  const lines = buildSaleEtaxLines(sale);
  const { error } = await supabase.rpc("record_sale_tax_invoice", {
    p_sale_id: saleId,
    p_invoice: {
      provider: "manual",
      mgt_key: `manual-${book}-${sale.doc_no}`,
      nts_confirm_num: opts.taxDocNo.trim(),
      state: "issued",
      purpose: "charge",
      write_date: writeDateIso,
      supplier: company ? { corpNum: digitsOnly(company.business_no), name: company.name } : {},
      buyer: { corpNum: digitsOnly(partner?.business_no ?? ""), name: partner?.name ?? "" },
      lines,
      supply_krw: Number(sale.subtotal_krw),
      vat_krw: Number(sale.vat_krw),
      total_krw: Number(sale.total_krw),
      item_summary: summarizeEtaxLines(lines),
      remark: "수기 기록(종이/면세계산서)",
      asp_response: null,
    },
  });
  if (error) return { ok: false, error: error.message };
  revalidateTransactionPaths("sales");
  await notifyKakaoWork(
    `🧾 세금계산서 기록(수기) · ${BOOK_LABEL[book]}\n` +
      `거래처: ${partner?.name ?? "—"}\n` +
      `금액: ${fmtWon(Number(sale.total_krw))}\n` +
      `번호: ${opts.taxDocNo.trim()}\n` +
      adminUrl(`/${book}/sales/${saleId}`),
  );
  return { ok: true, state: "issued", ntsConfirmNum: opts.taxDocNo.trim() };
}
