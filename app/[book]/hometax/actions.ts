"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isValidBook } from "@/lib/book";
import { collectBothDirections, type CollectResult } from "@/lib/hometax/collect";
import { applyBuy, classifyPartner, planBuy, type SupplyKind } from "@/lib/hometax/reconcile-buy";
import type { HometaxInvoiceInsert, HometaxMatchStatus } from "@/lib/hometax/types";
import type { ExcelInvoiceRow } from "@/lib/hometax/excel";
import type { HometaxDateType } from "@/lib/hometax/types";

export type CollectNowResult =
  | { ok: true; sell: CollectResult; buy: CollectResult }
  | { ok: false; error: string };

/**
 * [지금 수집] — 로그인 사용자 권한(RLS staff)으로 팝빌에 수집을 요청하고 저장한다.
 * 매출·매입을 차례로 돌리며, 한쪽이 실패해도 다른 쪽 결과는 돌려준다.
 */
export async function collectNow(formData: FormData): Promise<CollectNowResult> {
  const str = (k: string) => (formData.get(k) as string | null)?.trim() ?? "";
  const book = str("book");
  if (!isValidBook(book) || book === "b") return { ok: false, error: "법인 또는 사업자 책을 선택해 주세요." };
  const dateType = (str("date_type") || "S").toUpperCase();
  if (!["W", "I", "S"].includes(dateType)) return { ok: false, error: "기준일 유형이 올바르지 않습니다." };
  const from = str("from");
  const to = str("to");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, error: "기간을 입력해 주세요." };
  if (from > to) return { ok: false, error: "시작일이 종료일보다 늦습니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const r = await collectBothDirections(supabase, {
    book,
    dateType: dateType as HometaxDateType,
    from,
    to,
    source: "manual",
    requestedBy: user.id,
  });
  revalidatePath(`/${book}/hometax`);
  revalidatePath(`/all/hometax`);
  return { ok: true, sell: r.sell, buy: r.buy };
}

export type ClassifyResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * 매입 탭 '분류 대기' 행 — 공급자 종류를 정하고(재고 매입처/비용 업체) 그 수집본을 바로 처리한다(매입 생성 또는 영수증 생성).
 * 같은 공급자의 다른 대기 행은 다음 엑셀 업로드 때 자동 처리된다. 작업(job)으로 기록해 되돌릴 수 있다.
 */
export async function classifyAndProcess(nts: string, kind: SupplyKind): Promise<ClassifyResult> {
  if (kind !== "inventory" && kind !== "expense") return { ok: false, error: "종류가 올바르지 않습니다." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const { data: inv, error } = await supabase.from("hometax_invoice").select("*").eq("nts_confirm_num", nts).single();
  if (error || !inv) return { ok: false, error: "수집본을 찾을 수 없습니다." };
  if (inv.direction !== "buy") return { ok: false, error: "매입 계산서만 분류할 수 있습니다." };
  // 아직 처리 안 된 '분류 대기' 행만 — 옛 화면·두 번 누르기로 이미 연결·무시(매입 삭제)된 행을 다시 처리하지 않게.
  if (inv.match_status !== "candidate" || inv.purchase_id || inv.receipt_id || !String(inv.notes ?? "").startsWith("분류 대기")) {
    return { ok: false, error: "이미 처리된 계산서입니다 — 화면을 새로고침하세요." };
  }
  const book = inv.book as "bk" | "sl";
  const { data: job } = await supabase
    .from("hometax_collection_job")
    .insert({ book, direction: "buy", date_type: "W", from_date: inv.write_date, to_date: inv.write_date, state: "running", source: "manual", file_name: `classify ${inv.supplier?.name ?? ""} → ${kind}`, requested_by: user.id })
    .select("id")
    .single();
  try {
    const actions = [await classifyPartner(supabase, inv.supplier?.biz_no || inv.supplier?.name || "", kind)];
    const row: ExcelInvoiceRow = { rowNo: 0, insert: inv as unknown as HometaxInvoiceInsert, collectType: null, popbillMatched: null };
    const existing = new Map<string, HometaxMatchStatus>(); // 이 행은 다시 판정한다
    const report = await planBuy(supabase, book, [row], existing);
    actions.push(...(await applyBuy(supabase, book, [row], report)));
    if (job) await supabase.from("hometax_collection_job").update({ state: "done", found: 1, updated: 1, details: { actions, summary: report.summary }, finished_at: new Date().toISOString() }).eq("id", job.id);
    revalidatePath(`/${book}/hometax`);
    revalidatePath(`/all/hometax`);
    revalidatePath(`/${book}/purchases`);
    revalidatePath(`/${book}/receipts`);
    const d = report.decisions[0];
    return { ok: true, message: d ? d.note : "처리됨" };
  } catch (e) {
    if (job) await supabase.from("hometax_collection_job").update({ state: "failed", error: (e as Error).message, finished_at: new Date().toISOString() }).eq("id", job.id);
    return { ok: false, error: e instanceof Error ? e.message : "처리 실패" };
  }
}

/**
 * 지운 매입의 공급자 계산서(수집본) 정리 완료 — 공급자 수정세금계산서(−)를 받았거나 대체 매입에 반영했으면 표시한다.
 * close_deleted_purchase_invoice RPC(0095): 그 책 manager 이상, 지운 매입에 연결된 매입 계산서만.
 */
export async function closeDeletedPurchaseInvoice(hometaxInvoiceId: string, note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_deleted_purchase_invoice", {
    p_hometax_invoice_id: hometaxInvoiceId,
    p_note: note.trim().slice(0, 300) || null,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("Could not find the function") ? "정리 기능(마이그레이션 0095)이 DB에 아직 적용되지 않았습니다." : error.message,
    };
  }
  for (const b of ["all", "bk", "sl"]) revalidatePath(`/${b}/hometax`);
  return { ok: true };
}
