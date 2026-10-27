/**
 * 홈택스 매입 수집본 대조 — 기획 §15 (사장 결정 2026-10-27).
 *   분류 = 거래처(partner.supply_kind): inventory → 매입 생성 / expense → 영수증(비용) 생성 / NULL → 분류 대기(사람이 한 번 정하면 다음부터 자동).
 *   기존 매입이 있으면(매입처·금액 일치·미증빙·±10일) 생성 대신 연결(tax_doc_no). 같은 금액 매입이 180일 안에 있으면 중복 가드.
 *   생성 매입: 작성일 기준, 입고완료, 금액 라인 1줄(철제 직접입력·ea·수량 1·bars_count 1·중량 없음 = 품목 미정), 미지급(결제예정 +30).
 *   모든 쓰기는 Action 으로 남겨 rollbackActions 가 되돌린다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book } from "@/lib/book";
import { normalizeNts } from "./normalize";
import type { HometaxInvoiceInsert, HometaxMatchStatus } from "./types";
import type { ExcelInvoiceRow } from "./excel";
import type { Action } from "./reconcile";

const STEEL_CUSTOM_ITEM_ID = "00000000-0000-0000-0000-0000000057ee";
const bizKey = (v: unknown) => normalizeNts(v);
const nameKey = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, "")
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|（주）/g, "")
    .toLowerCase();
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

export type SupplyKind = "inventory" | "expense";
export const SUPPLY_KIND_LABEL: Record<SupplyKind, string> = { inventory: "재고 매입처", expense: "비용 업체" };

/** 품목명으로 비용 분류 제안 — 제안만, 자동 확정은 거래처 supply_kind 로만. */
export function guessExpenseCategory(itemSummary: string | null): string {
  const s = itemSummary ?? "";
  if (/운송|운반|운임|배송/.test(s)) return "운송비";
  if (/렌트|리스|주유|차량|타이어/.test(s)) return "차량";
  if (/수리|출장|정비|점검/.test(s)) return "수리비";
  if (/장갑|공구|소모|자재|사무/.test(s)) return "소모품";
  if (/전기|통신|전자|모타|모터/.test(s)) return "설비·전기";
  if (/카드/.test(s)) return "카드";
  return "기타";
}
/** 품목명이 재고성(철근·고철)인지 — 분류 대기 행의 제안 표시용. */
export function looksLikeInventory(itemSummary: string | null): boolean {
  return /철근|고철|스크랩|형강|각관|각파이프|빔|매각|철재|철판|파이프/.test(itemSummary ?? "");
}

type PurchaseLite = {
  id: string;
  doc_no: string;
  ordered_on: string;
  total_krw: number;
  is_documented: boolean;
  tax_doc_no: string | null;
  status: string;
  paid_on: string | null;
  partner_id: string | null;
};
type PartnerLite = { id: string; name: string; business_no: string | null; supply_kind: SupplyKind | null };

export type BuyDecision = {
  nts: string;
  rowNo: number;
  write_date: string;
  supplierName: string | null;
  supplierBiz: string;
  total: number;
  itemSummary: string | null;
  isModify: boolean;
  case: "P_link" | "P_create" | "R_create" | "K_pending" | "D_modify" | "D_dup" | "S_skip";
  status: HometaxMatchStatus;
  note: string;
  partner: PartnerLite | null; // 찾은 거래처(없으면 null → 생성 대상)
  purchaseId?: string;
  purchaseDocNo?: string;
  suggestion?: SupplyKind; // 대기 행의 제안
  candidates?: Array<{ doc_no: string; total: number; ordered_on: string; paid: boolean; has_doc: boolean }>;
};

export type BuyReport = { decisions: BuyDecision[]; summary: Record<string, number> };

async function loadSystem(sb: SupabaseClient, book: Book, from: string, to: string) {
  const pad = (d: string, days: number) => addDays(d, days);
  const [pRes, partnersRes] = await Promise.all([
    sb
      .from("purchase")
      .select("id, doc_no, ordered_on, total_krw, is_documented, tax_doc_no, status, paid_on, partner_id")
      .eq("book", book)
      .is("deleted_at", null) // purchase_status 에는 취소가 없다(scrapped 는 재고 폐기라 매입 자체는 유효)
      .gte("ordered_on", pad(from, -180))
      .lte("ordered_on", pad(to, 31)),
    sb.from("partner").select("id, name, business_no, supply_kind").is("deleted_at", null),
  ]);
  if (pRes.error) throw new Error(`매입 조회 실패: ${pRes.error.message}`);
  if (partnersRes.error) throw new Error(`거래처 조회 실패: ${partnersRes.error.message}`);
  return {
    purchases: (pRes.data ?? []).map((r) => ({ ...r, total_krw: Number(r.total_krw ?? 0) })) as PurchaseLite[],
    partners: (partnersRes.data ?? []) as PartnerLite[],
  };
}

export async function planBuy(sb: SupabaseClient, book: Book, rows: ExcelInvoiceRow[], existingStatus: Map<string, HometaxMatchStatus>): Promise<BuyReport> {
  const buyRows = rows.filter((r) => r.insert.direction === "buy");
  const dates = buyRows.map((r) => r.insert.write_date).sort();
  if (dates.length === 0) return { decisions: [], summary: {} };
  const { purchases, partners } = await loadSystem(sb, book, dates[0], dates[dates.length - 1]);
  const byBiz = new Map<string, PartnerLite[]>();
  const byName = new Map<string, PartnerLite[]>();
  for (const p of partners) {
    const b = bizKey(p.business_no);
    if (b) byBiz.set(b, [...(byBiz.get(b) ?? []), p]);
    const n = nameKey(p.name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), p]);
  }
  const covered = new Set<string>();
  const decisions: BuyDecision[] = [];
  for (const r of buyRows) {
    const ins = r.insert;
    const sup = ins.supplier;
    const base = {
      nts: ins.nts_confirm_num,
      rowNo: r.rowNo,
      write_date: ins.write_date,
      supplierName: sup.name,
      supplierBiz: sup.biz_no,
      total: ins.total_amount,
      itemSummary: ins.item_summary,
      isModify: (ins.modify_code ?? 0) !== 0,
    };
    const prev = existingStatus.get(ins.nts_confirm_num);
    if (prev && ["matched", "linked", "ignored"].includes(prev)) {
      decisions.push({ ...base, case: "S_skip", status: prev, note: `이미 처리됨(${prev})`, partner: null });
      continue;
    }
    if (base.isModify) {
      decisions.push({ ...base, case: "D_modify", status: "candidate", note: `수정세금계산서${ins.orig_nts_confirm_num ? ` — 당초 ${ins.orig_nts_confirm_num}` : ""} · 순합계 확인 필요`, partner: null });
      continue;
    }
    const partner = (byBiz.get(bizKey(sup.biz_no)) ?? byName.get(nameKey(sup.name)) ?? [])[0] ?? null;
    const cands = partner ? purchases.filter((p) => p.partner_id === partner.id) : [];
    const toCand = (p: PurchaseLite) => ({ doc_no: p.doc_no, total: p.total_krw, ordered_on: p.ordered_on, paid: !!p.paid_on, has_doc: !!p.tax_doc_no });
    // 연결 후보: 미증빙·자료·금액 일치·±10일
    const exact = cands.filter((p) => p.is_documented && !p.tax_doc_no && !covered.has(p.id) && Math.abs(p.total_krw - ins.total_amount) < 1 && daysBetween(p.ordered_on, ins.write_date) <= 10);
    if (exact.length === 1) {
      covered.add(exact[0].id);
      decisions.push({ ...base, case: "P_link", status: "linked", partner, purchaseId: exact[0].id, purchaseDocNo: exact[0].doc_no, note: `기존 매입 ${exact[0].doc_no} 금액 일치 → 승인번호 연결` });
      continue;
    }
    // 중복 가드: 같은 금액 매입이 180일 안에(증빙 있든 없든, 이미 짝지어졌든)
    const dup = cands.find((p) => Math.abs(p.total_krw - ins.total_amount) < 1 && daysBetween(p.ordered_on, ins.write_date) <= 180 && (p.tax_doc_no || covered.has(p.id) || exact.length !== 1));
    if (dup) {
      decisions.push({ ...base, case: "D_dup", status: "candidate", partner, candidates: [toCand(dup)], note: `같은 금액 매입 ${dup.doc_no}(${dup.tax_doc_no ? "증빙 있음" : "미증빙"}) 있음 — 중복·재발행 의심, 생성 안 함` });
      continue;
    }
    const kind = partner?.supply_kind ?? null;
    const suggestion: SupplyKind = looksLikeInventory(ins.item_summary) ? "inventory" : "expense";
    if (kind === "inventory") {
      decisions.push({ ...base, case: "P_create", status: "linked", partner, note: `재고 매입처 → 매입 생성(품목 미정)` });
    } else if (kind === "expense") {
      decisions.push({ ...base, case: "R_create", status: "linked", partner, note: `비용 업체 → 영수증 생성(${guessExpenseCategory(ins.item_summary)})` });
    } else {
      decisions.push({
        ...base,
        case: "K_pending",
        status: "candidate",
        partner,
        suggestion,
        note: `분류 대기 — ${partner ? "거래처 종류 미지정" : "처음 보는 공급자"} · 제안: ${SUPPLY_KIND_LABEL[suggestion]}`,
      });
    }
  }
  const summary: Record<string, number> = {};
  for (const d of decisions) summary[d.case] = (summary[d.case] ?? 0) + 1;
  return { decisions, summary };
}

async function nextPurchaseDocNo(sb: SupabaseClient, orderedOn: string): Promise<string> {
  const { count } = await sb.from("purchase").select("id", { count: "exact", head: true }).eq("ordered_on", orderedOn);
  return `${orderedOn.replace(/-/g, "")}-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

/** 거래처 확보 — 기존 id 또는 생성(사업자번호·상호·대표자·이메일). 같은 실행 안에서는 한 번만. */
async function ensurePartner(sb: SupabaseClient, ins: HometaxInvoiceInsert, existing: PartnerLite | null, cache: Map<string, string>, actions: Action[], log: (m: string) => void): Promise<string> {
  if (existing) return existing.id;
  const key = ins.supplier.biz_no || `name:${ins.supplier.name ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (ins.supplier.biz_no) {
    const { data: found } = await sb.from("partner").select("id").eq("business_no", ins.supplier.biz_no).is("deleted_at", null).order("created_at").limit(1).maybeSingle();
    if (found) {
      cache.set(key, String(found.id));
      return String(found.id);
    }
  }
  const { data: p, error } = await sb
    .from("partner")
    .insert({ name: ins.supplier.name ?? ins.supplier.biz_no, business_no: ins.supplier.biz_no || null, representative: ins.supplier.ceo, email: ins.supplier.email, notes: `홈택스 매입 수집본에서 자동 생성 (${ins.write_date} 계산서)` })
    .select("id")
    .single();
  if (error || !p) throw new Error(`거래처 생성 실패(${ins.supplier.name}): ${error?.message}`);
  cache.set(key, String(p.id));
  actions.push({ type: "partner_created", partner_id: String(p.id), name: ins.supplier.name ?? "" });
  log(`거래처 생성: ${ins.supplier.name} (${ins.supplier.biz_no})`);
  return String(p.id);
}

export async function createPurchaseFromInvoice(sb: SupabaseClient, book: Book, ins: HometaxInvoiceInsert, partnerId: string, log: (m: string) => void): Promise<{ purchaseId: string; docNo: string }> {
  const { data: wh } = await sb.from("warehouse").select("id").eq("code", "WH-MAIN").maybeSingle();
  if (!wh) throw new Error("기본 창고(WH-MAIN)가 없습니다.");
  const { data: zone } = await sb.from("warehouse_zone").select("id").eq("warehouse_id", wh.id).eq("preferred_book", book).maybeSingle();
  const isFree = ins.kind === "invoice";
  const header = {
    book,
    status: "in_stock",
    partner_id: partnerId,
    site_id: "",
    site_name: "",
    ordered_on: ins.write_date,
    delivered_on: ins.write_date,
    is_documented: true,
    tax_doc_type: isFree ? "invoice" : "tax_invoice_electronic",
    tax_doc_no: ins.nts_confirm_num,
    vat_type: isFree ? "exempt" : "standard_10",
    vat_rate: isFree ? 0 : 10,
    subtotal_krw: ins.supply_amount,
    vat_krw: ins.tax_amount,
    total_krw: ins.total_amount,
    payment_due_on: addDays(ins.write_date, 30),
    paid_on: "",
    notes: `홈택스 매입 계산서(승인 ${ins.nts_confirm_num})로 자동 생성 — 품목·중량·현장은 수정에서 채울 것`,
  };
  const lines = [
    {
      warehouse_id: wh.id,
      warehouse_zone_id: zone?.id ?? "",
      item_id: STEEL_CUSTOM_ITEM_ID,
      acquired_unit: "ea",
      acquired_qty: 1,
      unit_price_krw: ins.supply_amount,
      bars_count: 1, // ea 단위 CHECK(chk_bars_count_required)
      theoretical_weight_kg: "",
      actual_weight_kg: "",
      invoiced_weight_kg: "",
      price_basis: "theoretical",
      line_subtotal_krw: ins.supply_amount,
      line_status: "in_stock",
    },
  ];
  let purchaseId: string | null = null;
  let docNo = "";
  for (let attempt = 0; attempt < 3 && !purchaseId; attempt++) {
    docNo = await nextPurchaseDocNo(sb, ins.write_date);
    const { data, error } = await sb.rpc("create_purchase_with_lines", { p_purchase: { ...header, doc_no: docNo }, p_lines: lines });
    if (!error) purchaseId = String(data);
    else if (!/doc_no|duplicate key/.test(error.message)) throw new Error(`매입 생성 실패(${ins.supplier.name}): ${error.message}`);
  }
  if (!purchaseId) throw new Error(`매입 번호 충돌로 생성 실패: ${docNo}`);
  // 품목 라인 표시명(철제 직접입력 라벨)은 purchase_line.notes 로 — 매입 라인엔 display_name 이 없다
  await sb.from("purchase_line").update({ notes: `홈택스 계산서분 — ${ins.item_summary ?? "품목 미정"}` }).eq("purchase_id", purchaseId);
  const { error: oErr } = await sb.from("purchase").update({ origin: "hometax", origin_ref: ins.nts_confirm_num, tax_invoice_received_on: ins.write_date }).eq("id", purchaseId);
  if (oErr) log(`  origin 표시 실패(${docNo}): ${oErr.message}`);
  return { purchaseId, docNo };
}

export async function applyBuy(sb: SupabaseClient, book: Book, rows: ExcelInvoiceRow[], report: BuyReport, log: (m: string) => void = () => {}): Promise<Action[]> {
  const actions: Action[] = [];
  const byNts = new Map(rows.map((r) => [r.insert.nts_confirm_num, r]));
  const { data: existing } = await sb.from("hometax_invoice").select("nts_confirm_num, match_status, sale_id, tax_invoice_id, notes").in("nts_confirm_num", rows.map((r) => r.insert.nts_confirm_num));
  const existingMap = new Map((existing ?? []).map((e) => [String(e.nts_confirm_num), e]));
  const partnerCache = new Map<string, string>();

  for (const d of report.decisions) {
    if (d.case === "S_skip") continue;
    const row = byNts.get(d.nts);
    if (!row) continue;
    const ins = row.insert;
    const prev = existingMap.get(d.nts);
    const prevState = prev
      ? { match_status: String(prev.match_status), sale_id: (prev.sale_id as string | null) ?? null, tax_invoice_id: (prev.tax_invoice_id as string | null) ?? null, notes: (prev.notes as string | null) ?? null }
      : { match_status: "unmatched", sale_id: null, tax_invoice_id: null, notes: null };
    let purchaseId: string | null = null;
    let receiptId: string | null = null;
    let notes = d.note;

    if (d.case === "P_link" && d.purchaseId) {
      const { data: before } = await sb.from("purchase").select("tax_doc_no, tax_invoice_received_on").eq("id", d.purchaseId).single();
      const { error } = await sb.from("purchase").update({ tax_doc_no: d.nts, tax_invoice_received_on: ins.write_date }).eq("id", d.purchaseId);
      if (error) throw new Error(`매입 연결 실패(${d.purchaseDocNo}): ${error.message}`);
      actions.push({ type: "purchase_linked", purchase_id: d.purchaseId, prev: { tax_doc_no: (before?.tax_doc_no as string | null) ?? null, tax_invoice_received_on: (before?.tax_invoice_received_on as string | null) ?? null } });
      const { data: memo } = await sb.from("purchase_memo").insert({ purchase_id: d.purchaseId, body: `[홈택스 대조] 매입 계산서 연결 — 승인번호 ${d.nts}, 작성일 ${ins.write_date}, 합계 ${won(ins.total_amount)}원` }).select("id").single();
      if (memo) actions.push({ type: "purchase_memo_created", memo_id: String(memo.id), purchase_id: d.purchaseId });
      purchaseId = d.purchaseId;
      log(`연결: ${d.purchaseDocNo} ← ${d.nts}`);
    } else if (d.case === "P_create") {
      const partnerId = await ensurePartner(sb, ins, d.partner, partnerCache, actions, log);
      const created = await createPurchaseFromInvoice(sb, book, ins, partnerId, log);
      purchaseId = created.purchaseId;
      actions.push({ type: "purchase_created", purchase_id: created.purchaseId, doc_no: created.docNo });
      const { data: memo } = await sb
        .from("purchase_memo")
        .insert({ purchase_id: created.purchaseId, body: `[홈택스 대조] 홈택스 매입 계산서로 매입 생성 — 승인번호 ${d.nts}, 작성일 ${ins.write_date}, 합계 ${won(ins.total_amount)}원, 품목 "${ins.item_summary ?? ""}" · 품목·중량·현장 미정 → 수정에서 채울 것` })
        .select("id")
        .single();
      if (memo) actions.push({ type: "purchase_memo_created", memo_id: String(memo.id), purchase_id: created.purchaseId });
      notes = `매입 ${created.docNo} 생성(홈택스 매입분) · 품목 미정`;
      log(`매입 생성: ${created.docNo} ← ${d.nts} (${ins.supplier.name} ${won(ins.total_amount)})`);
    } else if (d.case === "R_create") {
      const partnerId = await ensurePartner(sb, ins, d.partner, partnerCache, actions, log);
      const category = guessExpenseCategory(ins.item_summary);
      const { data: rc, error } = await sb
        .from("receipt")
        .insert({
          book,
          receipt_on: ins.write_date,
          category,
          partner_id: partnerId,
          amount_krw: ins.total_amount,
          vat_included: true,
          tax_doc_type: ins.kind === "invoice" ? "invoice" : "tax_invoice_electronic",
          tax_doc_no: ins.nts_confirm_num,
          notes: `홈택스 매입 계산서 — ${ins.item_summary ?? ""} (공급가액 ${won(ins.supply_amount)} + 세액 ${won(ins.tax_amount)})`,
          origin: "hometax",
          origin_ref: ins.nts_confirm_num,
        })
        .select("id")
        .single();
      if (error || !rc) throw new Error(`영수증 생성 실패(${ins.supplier.name}): ${error?.message}`);
      receiptId = String(rc.id);
      actions.push({ type: "receipt_created", receipt_id: receiptId });
      notes = `비용(영수증) 생성 · ${category}`;
      log(`비용 생성: ${category} ${ins.supplier.name} ${won(ins.total_amount)} ← ${d.nts}`);
    } else if (d.candidates?.length) {
      notes = `${d.note} | 후보: ${d.candidates.map((c) => `${c.doc_no} ${won(c.total)}${c.paid ? "(결제완료)" : ""}`).join(", ")}`;
    }

    const { error: uErr } = await sb
      .from("hometax_invoice")
      .update({
        match_status: d.status,
        purchase_id: purchaseId,
        receipt_id: receiptId,
        matched_at: d.status === "linked" ? new Date().toISOString() : null,
        notes,
      })
      .eq("nts_confirm_num", d.nts);
    if (uErr) throw new Error(`상태 갱신 실패(${d.nts}): ${uErr.message}`);
    actions.push({ type: "invoice_status", nts: d.nts, prev: prevState });
  }
  return actions;
}

/** 거래처 종류 지정 — 없는 거래처는 수집본의 공급자 정보로 만든다. 되돌리기용 action 반환. */
export async function classifyPartner(sb: SupabaseClient, key: string, kind: SupplyKind, log: (m: string) => void = () => {}): Promise<Action> {
  type PL = { id: string; name: string; supply_kind: SupplyKind | null };
  const biz = bizKey(key);
  let partner: PL | null = null;
  if (biz.length === 10) {
    const { data } = await sb.from("partner").select("id, name, supply_kind").eq("business_no", biz).is("deleted_at", null).order("created_at").limit(1).maybeSingle();
    partner = (data as PL | null) ?? null;
  }
  if (!partner) {
    const { data } = await sb.from("partner").select("id, name, supply_kind").eq("name", key.trim()).is("deleted_at", null).order("created_at").limit(1).maybeSingle();
    partner = (data as PL | null) ?? null;
  }
  if (!partner) {
    // 수집본에서 공급자 정보를 찾아 생성
    const q = biz.length === 10 ? sb.from("hometax_invoice").select("supplier").eq("direction", "buy").eq("supplier->>biz_no", biz) : sb.from("hometax_invoice").select("supplier").eq("direction", "buy").eq("supplier->>name", key.trim());
    const { data: hi } = await q.order("write_date", { ascending: false }).limit(1).maybeSingle();
    const sup = (hi?.supplier ?? null) as { biz_no?: string; name?: string | null; ceo?: string | null; email?: string | null } | null;
    if (!sup) throw new Error(`거래처를 찾을 수 없습니다: ${key}`);
    const { data: p, error } = await sb.from("partner").insert({ name: sup.name ?? sup.biz_no, business_no: sup.biz_no || null, representative: sup.ceo ?? null, email: sup.email ?? null, supply_kind: kind, notes: "홈택스 매입 수집본에서 자동 생성(분류 지정)" }).select("id, name").single();
    if (error || !p) throw new Error(`거래처 생성 실패(${key}): ${error?.message}`);
    log(`거래처 생성+분류: ${p.name} → ${SUPPLY_KIND_LABEL[kind]}`);
    return { type: "partner_created", partner_id: String(p.id), name: String(p.name) };
  }
  const { error } = await sb.from("partner").update({ supply_kind: kind }).eq("id", partner.id);
  if (error) throw new Error(`분류 저장 실패(${partner.name}): ${error.message}`);
  log(`분류: ${partner.name} → ${SUPPLY_KIND_LABEL[kind]}`);
  return { type: "partner_kind_set", partner_id: partner.id, prev: partner.supply_kind, next: kind };
}
