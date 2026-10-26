/**
 * 홈택스 수집본(엑셀 입구) 매출 대사 — 기획 §3.1 ①②③ + §11 (거래처명 폴백·수집유형).
 * 자동으로 하는 것: B 팝빌 발행분 승인번호 일치(matched) · A 매출 일치+발행기록 없음 → 발행 기록 생성(linked) · C 거래처 사업자번호 채움.
 * 사람에게 남기는 것: 금액 불일치(candidate) · 누락(unmatched) · 수정분 묶음 · 시스템에만 있는 자료 매출(E).
 * 모든 쓰기는 actions 에 이전 값과 함께 남겨 rollbackJob 이 되돌린다. 운영 DB 하나뿐이라 필수.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book } from "@/lib/book";
import { normalizeNts } from "./normalize";
import type { HometaxInvoiceInsert, HometaxMatchStatus } from "./types";
import type { ExcelInvoiceRow } from "./excel";

type Rec = Record<string, unknown>;
const bizKey = (v: unknown) => normalizeNts(v);
const nameKey = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, "")
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, "")
    .toLowerCase();

export type SaleLite = {
  id: string;
  doc_no: string;
  book: Book;
  ordered_on: string;
  delivered_on: string | null;
  total_krw: number;
  subtotal_krw: number;
  vat_krw: number;
  is_documented: boolean;
  tax_doc_type: string;
  status: string;
  settled_on: string | null;
  partner_id: string | null;
  partner_name: string | null;
  partner_biz: string | null;
};

export type Decision = {
  nts: string;
  rowNo: number;
  collectType: ExcelInvoiceRow["collectType"];
  write_date: string;
  partyName: string | null;
  partyBiz: string;
  total: number;
  isModify: boolean;
  origNts: string | null;
  case: "B_popbill" | "A_link" | "D_modify" | "X_amount" | "N_missing" | "S_skip";
  status: HometaxMatchStatus;
  saleId?: string;
  saleDocNo?: string;
  taxInvoiceId?: string;
  settled?: boolean;
  note: string;
  candidates?: Array<{ doc_no: string; total: number; ordered_on: string; settled: boolean; has_invoice: boolean }>;
  partnerFix?: { partner_id: string; name: string; old_biz: string | null; new_biz: string };
};

export type Action =
  | { type: "invoice_insert"; nts: string }
  | { type: "invoice_status"; nts: string; prev: { match_status: string; sale_id: string | null; tax_invoice_id: string | null; notes: string | null } }
  | { type: "tax_invoice_created"; tax_invoice_id: string; sale_id: string; prev_sale: { tax_invoice_issued_on: string | null; tax_doc_no: string | null } }
  | { type: "memo_created"; memo_id: string; sale_id: string }
  | { type: "partner_biz_filled"; partner_id: string; prev: string | null; next: string }
  | { type: "payment_adjusted"; bank_transaction_id: string; sale_id: string; prev_amount: number; next_amount: number }
  | {
      type: "sale_aligned";
      sale_id: string;
      line_id: string; // adjust_sale_to_invoice 가 만든 조정 라인
      prev: { subtotal_krw: number; vat_krw: number; total_krw: number };
    };

export type ReconcileReport = {
  decisions: Decision[];
  systemOnly: Array<SaleLite & { note: string }>; // E: 자료 매출인데 홈택스에 없음
  summary: Record<string, number>;
};

/** 책의 매출(자료거래·취소 아님)과 활성 발행 기록을 기간 여유 있게 읽는다. */
async function loadSystem(sb: SupabaseClient, book: Book, from: string, to: string) {
  const pad = (d: string, days: number) => new Date(new Date(d).getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const [salesRes, invRes, partnersRes] = await Promise.all([
    sb
      .from("sale")
      .select("id, doc_no, book, ordered_on, delivered_on, total_krw, subtotal_krw, vat_krw, is_documented, tax_doc_type, status, settled_on, partner_id, partner:partner(name, business_no)")
      .eq("book", book)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .gte("ordered_on", pad(from, -60))
      .lte("ordered_on", pad(to, 31)),
    sb.from("tax_invoice").select("id, sale_id, nts_confirm_num, state, provider, total_krw").eq("book", book).is("deleted_at", null).neq("state", "cancelled"),
    sb.from("partner").select("id, name, business_no").is("deleted_at", null),
  ]);
  if (salesRes.error) throw new Error(`매출 조회 실패: ${salesRes.error.message}`);
  if (invRes.error) throw new Error(`발행 기록 조회 실패: ${invRes.error.message}`);
  if (partnersRes.error) throw new Error(`거래처 조회 실패: ${partnersRes.error.message}`);
  const sales: SaleLite[] = (salesRes.data ?? []).map((r) => {
    const o = r as unknown as Rec & { partner: { name: string; business_no: string | null } | null };
    return {
      id: String(o.id),
      doc_no: String(o.doc_no),
      book,
      ordered_on: String(o.ordered_on),
      delivered_on: (o.delivered_on as string | null) ?? null,
      total_krw: Number(o.total_krw ?? 0),
      subtotal_krw: Number(o.subtotal_krw ?? 0),
      vat_krw: Number(o.vat_krw ?? 0),
      is_documented: Boolean(o.is_documented),
      tax_doc_type: String(o.tax_doc_type),
      status: String(o.status),
      settled_on: (o.settled_on as string | null) ?? null,
      partner_id: (o.partner_id as string | null) ?? null,
      partner_name: o.partner?.name ?? null,
      partner_biz: o.partner?.business_no ?? null,
    };
  });
  const invoices = (invRes.data ?? []) as Array<{ id: string; sale_id: string; nts_confirm_num: string | null; state: string; provider: string; total_krw: number }>;
  const partners = (partnersRes.data ?? []) as Array<{ id: string; name: string; business_no: string | null }>;
  return { sales, invoices, partners };
}

const isDocSale = (s: SaleLite) => s.is_documented && ["tax_invoice_electronic", "tax_invoice_paper", "invoice"].includes(s.tax_doc_type);

/**
 * 결정만 계산한다(쓰기 없음) — dry-run 과 실제 반영이 같은 함수를 쓴다.
 * existingStatus: 이미 hometax_invoice 에 있는 행의 상태(matched/linked/ignored 면 건너뜀).
 */
export async function planReconcile(
  sb: SupabaseClient,
  book: Book,
  rows: ExcelInvoiceRow[],
  existingStatus: Map<string, HometaxMatchStatus>,
): Promise<ReconcileReport> {
  const sellRows = rows.filter((r) => r.insert.direction === "sell");
  const dates = sellRows.map((r) => r.insert.write_date).sort();
  if (dates.length === 0) return { decisions: [], systemOnly: [], summary: {} };
  const { sales, invoices, partners } = await loadSystem(sb, book, dates[0], dates[dates.length - 1]);

  const invByNts = new Map<string, (typeof invoices)[number]>();
  for (const i of invoices) if (i.nts_confirm_num) invByNts.set(normalizeNts(i.nts_confirm_num), i);
  const saleHasInvoice = new Set(invoices.map((i) => i.sale_id));
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const partnersByBiz = new Map<string, (typeof partners)[number][]>();
  const partnersByName = new Map<string, (typeof partners)[number][]>();
  for (const p of partners) {
    const b = bizKey(p.business_no);
    if (b) partnersByBiz.set(b, [...(partnersByBiz.get(b) ?? []), p]);
    const n = nameKey(p.name);
    if (n) partnersByName.set(n, [...(partnersByName.get(n) ?? []), p]);
  }

  const decisions: Decision[] = [];
  const coveredSaleIds = new Set<string>();
  for (const r of sellRows) {
    const ins = r.insert;
    const nts = ins.nts_confirm_num;
    const party = ins.invoicee;
    const base = {
      nts,
      rowNo: r.rowNo,
      collectType: r.collectType,
      write_date: ins.write_date,
      partyName: party.name,
      partyBiz: party.biz_no,
      total: ins.total_amount,
      isModify: (ins.modify_code ?? 0) !== 0,
      origNts: ins.orig_nts_confirm_num,
    };
    const prev = existingStatus.get(nts);
    if (prev && ["matched", "linked", "ignored"].includes(prev)) {
      decisions.push({ ...base, case: "S_skip", status: prev, note: `이미 처리됨(${prev})` });
      continue;
    }
    // B: 승인번호 일치
    const inv = invByNts.get(nts);
    if (inv) {
      coveredSaleIds.add(inv.sale_id);
      const s = saleById.get(inv.sale_id);
      decisions.push({ ...base, case: "B_popbill", status: "matched", saleId: inv.sale_id, saleDocNo: s?.doc_no, taxInvoiceId: inv.id, note: `발행 기록 일치(${inv.provider})` });
      continue;
    }
    // 수정분: 당초 건과 묶어 사람이 본다(순합계 판단은 2차)
    if (base.isModify) {
      decisions.push({ ...base, case: "D_modify", status: "candidate", note: `수정세금계산서${base.origNts ? ` — 당초 ${base.origNts}` : ""} · 순합계 확인 필요` });
      continue;
    }
    // 거래처 찾기 — 사업자번호 → 이름 폴백
    const byBiz = partnersByBiz.get(bizKey(party.biz_no)) ?? [];
    const byName = partnersByName.get(nameKey(party.name)) ?? [];
    const partnerIds = new Set([...byBiz, ...byName].map((p) => p.id));
    let partnerFix: Decision["partnerFix"] | undefined;
    if (byBiz.length === 0 && byName.length === 1 && !byName[0].business_no) {
      partnerFix = { partner_id: byName[0].id, name: byName[0].name, old_biz: null, new_biz: party.biz_no };
    }
    const cands = sales.filter((s) => s.partner_id && partnerIds.has(s.partner_id) && isDocSale(s));
    const exact = cands.filter((s) => Math.abs(s.total_krw - ins.total_amount) < 1 && !saleHasInvoice.has(s.id) && !coveredSaleIds.has(s.id));
    const toCand = (s: SaleLite) => ({ doc_no: s.doc_no, total: s.total_krw, ordered_on: s.ordered_on, settled: !!s.settled_on, has_invoice: saleHasInvoice.has(s.id) });
    if (exact.length === 1) {
      const s = exact[0];
      coveredSaleIds.add(s.id);
      decisions.push({ ...base, case: "A_link", status: "linked", saleId: s.id, saleDocNo: s.doc_no, settled: !!s.settled_on, partnerFix, note: `매출 ${s.doc_no} 금액 일치 → 발행 기록 생성` });
      continue;
    }
    if (exact.length > 1) {
      decisions.push({ ...base, case: "X_amount", status: "candidate", partnerFix, candidates: exact.map(toCand), note: `같은 금액 매출 ${exact.length}건 — 선택 필요` });
      continue;
    }
    if (cands.length > 0) {
      const open = cands.filter((s) => !saleHasInvoice.has(s.id)).sort((a, b) => Math.abs(a.total_krw - ins.total_amount) - Math.abs(b.total_krw - ins.total_amount));
      decisions.push({
        ...base,
        case: "X_amount",
        status: "candidate",
        partnerFix,
        candidates: open.slice(0, 5).map(toCand),
        note: open.length ? `거래처 있음 · 금액 불일치(가장 가까운 ${open[0].doc_no} ${open[0].total_krw.toLocaleString("ko-KR")})` : "거래처 있음 · 발행 안 된 매출 없음",
      });
      continue;
    }
    decisions.push({ ...base, case: "N_missing", status: "unmatched", partnerFix, note: partnerIds.size ? "거래처는 있으나 자료 매출 없음" : "시스템에 거래처·매출 없음" });
  }

  // E: 엑셀 기간(월) 안의 자료 매출 중 발행 기록 없고 어느 수집본에도 안 잡힌 것
  const monthFrom = dates[0].slice(0, 7) + "-01";
  const monthTo = dates[dates.length - 1];
  const systemOnly = sales
    .filter((s) => isDocSale(s) && !saleHasInvoice.has(s.id) && !coveredSaleIds.has(s.id) && s.ordered_on >= monthFrom && s.ordered_on <= monthTo)
    .map((s) => ({ ...s, note: "자료 매출인데 발행 기록 없음 · 홈택스에도 없음 → 미발행?" }));

  const summary: Record<string, number> = {};
  for (const d of decisions) summary[d.case] = (summary[d.case] ?? 0) + 1;
  summary.E_system_only = systemOnly.length;
  return { decisions, systemOnly, summary };
}

/** 결정을 실제로 반영한다. 모든 쓰기를 actions 로 돌려준다(작업 details 에 저장 → 롤백). */
export async function applyReconcile(
  sb: SupabaseClient,
  book: Book,
  rows: ExcelInvoiceRow[],
  report: ReconcileReport,
  jobId: string,
  log: (m: string) => void = () => {},
): Promise<Action[]> {
  const actions: Action[] = [];
  const byNts = new Map(rows.map((r) => [r.insert.nts_confirm_num, r]));

  // 1) 수집본 upsert — 새 행만 insert(이전 상태 보존을 위해 기존 행은 수집 컬럼만 갱신)
  const ntsAll = rows.map((r) => r.insert.nts_confirm_num);
  const { data: existing } = await sb.from("hometax_invoice").select("nts_confirm_num, match_status, sale_id, tax_invoice_id, notes").in("nts_confirm_num", ntsAll);
  const existingMap = new Map((existing ?? []).map((e) => [String(e.nts_confirm_num), e]));
  const toInsert: Array<HometaxInvoiceInsert & { collection_job_id: string }> = [];
  const toUpdate: HometaxInvoiceInsert[] = [];
  for (const r of rows) {
    if (existingMap.has(r.insert.nts_confirm_num)) toUpdate.push(r.insert);
    else toInsert.push({ ...r.insert, collection_job_id: jobId });
  }
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { error } = await sb.from("hometax_invoice").insert(chunk);
    if (error) throw new Error(`수집본 저장 실패: ${error.message}`);
    for (const c of chunk) actions.push({ type: "invoice_insert", nts: c.nts_confirm_num });
  }
  for (const u of toUpdate) {
    const { error } = await sb.from("hometax_invoice").update(u).eq("nts_confirm_num", u.nts_confirm_num);
    if (error) throw new Error(`수집본 갱신 실패: ${error.message}`);
  }
  log(`수집본 저장: 신규 ${toInsert.length} · 갱신 ${toUpdate.length}`);

  // 2) 결정 반영
  for (const d of report.decisions) {
    if (d.case === "S_skip") continue;
    const row = byNts.get(d.nts);
    if (!row) continue;
    const prev = existingMap.get(d.nts);
    const prevState = prev
      ? { match_status: String(prev.match_status), sale_id: (prev.sale_id as string | null) ?? null, tax_invoice_id: (prev.tax_invoice_id as string | null) ?? null, notes: (prev.notes as string | null) ?? null }
      : { match_status: "unmatched", sale_id: null, tax_invoice_id: null, notes: null };

    let taxInvoiceId = d.taxInvoiceId ?? null;
    if (d.case === "A_link" && d.saleId) {
      // 발행 기록 생성 — 기존 RPC(provider hometax). 이전 sale 발행 필드를 롤백용으로 보관.
      const { data: saleBefore } = await sb.from("sale").select("tax_invoice_issued_on, tax_doc_no").eq("id", d.saleId).single();
      const ins = row.insert;
      const { data: tiId, error } = await sb.rpc("record_sale_tax_invoice", {
        p_sale_id: d.saleId,
        p_invoice: {
          provider: "hometax",
          mgt_key: `hometax-${d.nts}`,
          nts_confirm_num: d.nts,
          state: "nts_approved",
          purpose: ins.purpose === "영수" ? "receipt" : "charge",
          write_date: ins.write_date,
          supplier: { corpNum: ins.supplier.biz_no, name: ins.supplier.name, ceoName: ins.supplier.ceo, email: ins.supplier.email },
          buyer: { corpNum: ins.invoicee.biz_no, name: ins.invoicee.name, ceoName: ins.invoicee.ceo, email: ins.invoicee.email },
          lines: ins.items ?? [],
          supply_krw: ins.supply_amount,
          vat_krw: ins.tax_amount,
          total_krw: ins.total_amount,
          item_summary: ins.item_summary,
          remark: "홈택스 수집본(팝빌 엑셀)에서 승격 — 홈택스 직접 발행분",
          asp_response: ins.raw,
        },
      });
      if (error) throw new Error(`발행 기록 생성 실패(${d.nts}): ${error.message}`);
      taxInvoiceId = String(tiId);
      actions.push({
        type: "tax_invoice_created",
        tax_invoice_id: taxInvoiceId,
        sale_id: d.saleId,
        prev_sale: { tax_invoice_issued_on: (saleBefore?.tax_invoice_issued_on as string | null) ?? null, tax_doc_no: (saleBefore?.tax_doc_no as string | null) ?? null },
      });
      const { data: memo, error: mErr } = await sb
        .from("sale_memo")
        .insert({ sale_id: d.saleId, body: `[홈택스 대조] 홈택스 직접 발행분과 연결 — 승인번호 ${d.nts}, 작성일 ${ins.write_date}, 합계 ${ins.total_amount.toLocaleString("ko-KR")}원 (팝빌 엑셀 ${ins.write_date.slice(0, 7)})` })
        .select("id")
        .single();
      if (!mErr && memo) actions.push({ type: "memo_created", memo_id: String(memo.id), sale_id: d.saleId });
      log(`A 연결: ${d.saleDocNo} ← ${d.nts}`);
    }
    if (d.partnerFix) {
      const { error } = await sb.from("partner").update({ business_no: d.partnerFix.new_biz }).eq("id", d.partnerFix.partner_id);
      if (!error) {
        actions.push({ type: "partner_biz_filled", partner_id: d.partnerFix.partner_id, prev: d.partnerFix.old_biz, next: d.partnerFix.new_biz });
        log(`C 거래처 사업자번호 채움: ${d.partnerFix.name} ← ${d.partnerFix.new_biz}`);
      }
    }
    const notes = [d.note, d.candidates?.length ? `후보: ${d.candidates.map((c) => `${c.doc_no} ${c.total.toLocaleString("ko-KR")}${c.settled ? "(수금완료)" : ""}`).join(", ")}` : null]
      .filter(Boolean)
      .join(" | ");
    const { error: uErr } = await sb
      .from("hometax_invoice")
      .update({
        match_status: d.status,
        sale_id: d.saleId ?? null,
        tax_invoice_id: taxInvoiceId,
        matched_at: ["matched", "linked"].includes(d.status) ? new Date().toISOString() : null,
        notes,
      })
      .eq("nts_confirm_num", d.nts);
    if (uErr) throw new Error(`상태 갱신 실패(${d.nts}): ${uErr.message}`);
    actions.push({ type: "invoice_status", nts: d.nts, prev: prevState });
  }
  return actions;
}

/** 작업 되돌리기 — actions 를 역순으로. 수집본 새 행은 삭제, 상태는 이전 값, 발행 기록은 삭제+매출 필드 복원, 메모 삭제, 거래처 번호 복원. */
export async function rollbackActions(sb: SupabaseClient, actions: Action[], log: (m: string) => void = () => {}): Promise<void> {
  for (const a of [...actions].reverse()) {
    if (a.type === "invoice_status") {
      await sb.from("hometax_invoice").update({ ...a.prev, matched_at: null }).eq("nts_confirm_num", a.nts);
    } else if (a.type === "memo_created") {
      await sb.from("sale_memo").delete().eq("id", a.memo_id);
    } else if (a.type === "tax_invoice_created") {
      // 우리가 만든 hometax 기록이므로 hard delete 가 맞다(취소 상태로 남기면 1:1 유니크·화면에 흔적이 남는다)
      await sb.from("tax_invoice").delete().eq("id", a.tax_invoice_id).eq("provider", "hometax");
      await sb.from("sale").update({ tax_invoice_issued_on: a.prev_sale.tax_invoice_issued_on, tax_doc_no: a.prev_sale.tax_doc_no }).eq("id", a.sale_id);
      log(`발행 기록 삭제·매출 필드 복원: ${a.sale_id}`);
    } else if (a.type === "payment_adjusted") {
      await sb.from("bank_transaction").update({ amount_krw: a.prev_amount }).eq("id", a.bank_transaction_id);
      log(`입금 기록 복원: ${a.bank_transaction_id} → ${a.prev_amount}`);
    } else if (a.type === "sale_aligned") {
      const { error } = await sb.rpc("revert_sale_invoice_adjustment", {
        p_sale_id: a.sale_id,
        p_line_id: a.line_id,
        p_prev_supply_krw: a.prev.subtotal_krw,
        p_prev_vat_krw: a.prev.vat_krw,
        p_prev_total_krw: a.prev.total_krw,
      });
      if (error) throw new Error(`매출 금액 복원 실패(${a.sale_id}): ${error.message}`);
      log(`조정 라인 제거·매출 금액 복원: ${a.sale_id}`);
    } else if (a.type === "partner_biz_filled") {
      await sb.from("partner").update({ business_no: a.prev }).eq("id", a.partner_id);
    } else if (a.type === "invoice_insert") {
      await sb.from("hometax_invoice").delete().eq("nts_confirm_num", a.nts);
    }
  }
}

// ------------------------------------------------------------
// 금액 불일치 — 홈택스 계산서 금액이 맞다고 보고 시스템 매출을 그 금액으로 맞춘다 (사장 결정 2026-10-26).
// 기존 품목 라인은 그대로 두고 "계산서 금액 맞춤" 조정 라인(철제 직접입력, 중량 없음)을 하나 더해 합계를 맞춘다.
// 발행 기록(provider hometax) 연결 + 매출 메모. 재고 할당이 있는 매출은 라인 교체로 할당이 지워지므로 거부한다.
// ------------------------------------------------------------
/**
 * 수금완료 매출의 입금 기록을 새 합계에 맞춘다 — 사장 결정(2026-10-26): "국세청 계산서 기준으로 데이터를 바꾸고 미수를 남기지 않는다".
 * 이 매출에 연결된 입금(bank_transaction, 양수) 합이 합계와 다르면 가장 최근 입금 1건의 금액을 차액만큼 고친다.
 * 통장 거래 금액이 바뀌므로 시스템 통장 잔액이 실제 은행과 어긋날 수 있다 — 메모에 남긴다.
 */
export async function alignPaymentToTotal(
  sb: SupabaseClient,
  saleId: string,
  totalKrw: number,
  log: (m: string) => void = () => {},
): Promise<{ actions: Action[]; diff: number; prevReceived: number } | null> {
  const { data: bts } = await sb.from("bank_transaction").select("id, txn_on, amount_krw").eq("sale_id", saleId).is("deleted_at", null).gt("amount_krw", 0).order("txn_on", { ascending: false }).order("created_at", { ascending: false });
  const rows = (bts ?? []) as Array<{ id: string; txn_on: string; amount_krw: number }>;
  if (rows.length === 0) return null;
  const received = rows.reduce((a, r) => a + Number(r.amount_krw), 0);
  const diff = totalKrw - received;
  if (diff === 0) return { actions: [], diff: 0, prevReceived: received };
  const last = rows[0];
  const next = Number(last.amount_krw) + diff;
  const { error } = await sb.from("bank_transaction").update({ amount_krw: next }).eq("id", last.id);
  if (error) throw new Error(`입금 기록 수정 실패: ${error.message}`);
  log(`입금 기록 ${last.txn_on}: ${Number(last.amount_krw).toLocaleString("ko-KR")} → ${next.toLocaleString("ko-KR")} (${diff >= 0 ? "+" : ""}${diff.toLocaleString("ko-KR")})`);
  return { actions: [{ type: "payment_adjusted", bank_transaction_id: last.id, sale_id: saleId, prev_amount: Number(last.amount_krw), next_amount: next }], diff, prevReceived: received };
}

export async function alignSaleToInvoice(
  sb: SupabaseClient,
  input: { saleId: string; nts: string; reason?: string },
  log: (m: string) => void = () => {},
): Promise<Action[]> {
  const actions: Action[] = [];
  const { data: inv, error: invErr } = await sb.from("hometax_invoice").select("*").eq("nts_confirm_num", input.nts).single();
  if (invErr || !inv) throw new Error(`수집본을 찾을 수 없습니다: ${input.nts}`);
  if (inv.direction !== "sell") throw new Error("매출 계산서만 맞출 수 있습니다.");
  const { data: sale, error: sErr } = await sb.from("sale").select("*").eq("id", input.saleId).is("deleted_at", null).single();
  if (sErr || !sale) throw new Error(`매출을 찾을 수 없습니다: ${input.saleId}`);
  if (sale.book !== inv.book) throw new Error(`책이 다릅니다(매출 ${sale.book} / 계산서 ${inv.book})`);
  const { data: existingInv } = await sb.from("tax_invoice").select("id, provider, nts_confirm_num").eq("sale_id", input.saleId).is("deleted_at", null).neq("state", "cancelled").maybeSingle();
  if (existingInv) throw new Error(`이 매출에는 이미 발행 기록이 있습니다(${existingInv.provider} ${existingInv.nts_confirm_num ?? ""}).`);

  const prev = { subtotal_krw: Number(sale.subtotal_krw), vat_krw: Number(sale.vat_krw), total_krw: Number(sale.total_krw) };
  const diffSupply = Number(inv.supply_amount) - prev.subtotal_krw;
  const diffVat = Number(inv.tax_amount) - prev.vat_krw;
  const diffTotal = Number(inv.total_amount) - prev.total_krw;
  const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
  const ntsTail = String(input.nts).slice(-6);

  if (diffSupply !== 0 || diffVat !== 0) {
    // 0086 — 기존 라인 불변, 조정 라인 1줄 + 합계 갱신
    const { data: lineId, error } = await sb.rpc("adjust_sale_to_invoice", {
      p_sale_id: input.saleId,
      p_supply_krw: Number(inv.supply_amount),
      p_vat_krw: Number(inv.tax_amount),
      p_total_krw: Number(inv.total_amount),
      p_label: `계산서 금액 맞춤(승인 …${ntsTail})`,
    });
    if (error) throw new Error(`매출 금액 수정 실패: ${error.message}`);
    actions.push({ type: "sale_aligned", sale_id: input.saleId, line_id: String(lineId), prev });
    log(`매출 ${sale.doc_no}: ${won(prev.total_krw)} → ${won(Number(inv.total_amount))} (${diffTotal >= 0 ? "+" : ""}${won(diffTotal)}) — 조정 라인 공급가액 ${won(diffSupply)} 추가`);
  } else {
    log(`매출 ${sale.doc_no}: 금액이 이미 같음 — 발행 기록만 연결`);
  }

  // 수금완료 건: 입금 기록도 계산서 합계로 맞춰 미수를 남기지 않는다(사장 결정)
  let paymentNote = "";
  if (sale.settled_on) {
    const pay = await alignPaymentToTotal(sb, input.saleId, Number(inv.total_amount), log);
    if (pay && pay.diff !== 0) {
      actions.push(...pay.actions);
      paymentNote = ` · 입금 기록도 계산서 금액으로 맞춤(${won(pay.prevReceived)} → ${won(Number(inv.total_amount))}, 통장 잔액 확인)`;
    }
  }

  // 발행 기록 + 메모 + 수집본 상태 (applyReconcile 의 A 와 같은 형태)
  const { data: saleBefore } = await sb.from("sale").select("tax_invoice_issued_on, tax_doc_no").eq("id", input.saleId).single();
  const { data: tiId, error: tiErr } = await sb.rpc("record_sale_tax_invoice", {
    p_sale_id: input.saleId,
    p_invoice: {
      provider: "hometax",
      mgt_key: `hometax-${input.nts}`,
      nts_confirm_num: input.nts,
      state: "nts_approved",
      purpose: inv.purpose === "영수" ? "receipt" : "charge",
      write_date: inv.write_date,
      supplier: { corpNum: inv.supplier?.biz_no, name: inv.supplier?.name, ceoName: inv.supplier?.ceo, email: inv.supplier?.email },
      buyer: { corpNum: inv.invoicee?.biz_no, name: inv.invoicee?.name, ceoName: inv.invoicee?.ceo, email: inv.invoicee?.email },
      lines: inv.items ?? [],
      supply_krw: inv.supply_amount,
      vat_krw: inv.tax_amount,
      total_krw: inv.total_amount,
      item_summary: inv.item_summary,
      remark: "홈택스 수집본(팝빌 엑셀)에서 승격 — 금액 불일치 맞춤",
      asp_response: inv.raw,
    },
  });
  if (tiErr) throw new Error(`발행 기록 생성 실패: ${tiErr.message}`);
  actions.push({
    type: "tax_invoice_created",
    tax_invoice_id: String(tiId),
    sale_id: input.saleId,
    prev_sale: { tax_invoice_issued_on: (saleBefore?.tax_invoice_issued_on as string | null) ?? null, tax_doc_no: (saleBefore?.tax_doc_no as string | null) ?? null },
  });
  const body =
    `[홈택스 대조] 계산서 금액으로 맞춤: ${won(Number(sale.total_krw))} → ${won(Number(inv.total_amount))} (${diffTotal >= 0 ? "+" : ""}${won(diffTotal)}원)` +
    ` — 홈택스 직접 발행 승인번호 ${input.nts}, 작성일 ${inv.write_date}` +
    (diffSupply !== 0 || diffVat !== 0 ? ` · 조정 라인 1줄 추가(공급가액 ${diffSupply >= 0 ? "+" : ""}${won(diffSupply)}, 세액 ${diffVat >= 0 ? "+" : ""}${won(diffVat)})` : "") +
    (input.reason ? ` · 사유: ${input.reason}` : "") +
    paymentNote;
  const { data: memo } = await sb.from("sale_memo").insert({ sale_id: input.saleId, body }).select("id").single();
  if (memo) actions.push({ type: "memo_created", memo_id: String(memo.id), sale_id: input.saleId });
  const prevState = { match_status: String(inv.match_status), sale_id: (inv.sale_id as string | null) ?? null, tax_invoice_id: (inv.tax_invoice_id as string | null) ?? null, notes: (inv.notes as string | null) ?? null };
  await sb
    .from("hometax_invoice")
    .update({ match_status: "linked", sale_id: input.saleId, tax_invoice_id: String(tiId), matched_at: new Date().toISOString(), notes: `금액 맞춤: 매출 ${sale.doc_no} ${won(Number(sale.total_krw))} → ${won(Number(inv.total_amount))}` })
    .eq("nts_confirm_num", input.nts);
  actions.push({ type: "invoice_status", nts: input.nts, prev: prevState });
  return actions;
}
