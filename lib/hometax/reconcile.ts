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
  case: "B_popbill" | "A_link" | "D_modify" | "X_amount" | "N_missing" | "D_dup" | "D_deleted" | "S_skip";
  status: HometaxMatchStatus;
  saleId?: string;
  saleDocNo?: string;
  taxInvoiceId?: string;
  settled?: boolean;
  note: string;
  candidates?: Array<{ doc_no: string; total: number; ordered_on: string; settled: boolean; has_invoice: boolean }>;
  partnerFix?: { partner_id: string; name: string; old_biz: string | null; new_biz: string };
  /** N_missing 일 때 매출 생성에 쓸 거래처 — 기존 id 또는 신규 생성 */
  partnerForCreate?: { partner_id: string | null; name: string; isNew: boolean };
};

export type Action =
  | { type: "invoice_insert"; nts: string }
  | { type: "invoice_status"; nts: string; prev: { match_status: string; sale_id: string | null; tax_invoice_id: string | null; notes: string | null } }
  | { type: "tax_invoice_created"; tax_invoice_id: string; sale_id: string; prev_sale: { tax_invoice_issued_on: string | null; tax_doc_no: string | null } }
  | { type: "memo_created"; memo_id: string; sale_id: string }
  | { type: "partner_biz_filled"; partner_id: string; prev: string | null; next: string }
  | { type: "payment_adjusted"; bank_transaction_id: string; sale_id: string; prev_amount: number; next_amount: number }
  | { type: "sale_created"; sale_id: string; doc_no: string }
  | { type: "purchase_created"; purchase_id: string; doc_no: string }
  | { type: "purchase_linked"; purchase_id: string; prev: { tax_doc_no: string | null; tax_invoice_received_on: string | null } }
  | { type: "purchase_memo_created"; memo_id: string; purchase_id: string }
  | { type: "invoice_notes"; nts: string; prev_notes: string | null } // 수집본 비고만 바꾼 것(당초 장 '취소·재발행됨' 표시) — 연결은 건드리지 않는다
  | { type: "receipt_created"; receipt_id: string }
  | { type: "partner_kind_set"; partner_id: string; prev: string | null; next: string }
  | { type: "partner_created"; partner_id: string; name: string }
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
      .gte("ordered_on", pad(from, -180)) // 중복 가드(같은 금액 매출 180일) — 8월 납품분을 10월에 발행하는 사례
      .lte("ordered_on", pad(to, 31)),
    // 발행 기록(모든 상태) + 그 매출의 삭제 여부 — 지운 매출의 계산서는 정리(취소) 뒤에도 알아봐야
    // 같은 계산서로 매출을 되살리거나 엉뚱한 매출에 붙이지 않는다(0094).
    sb
      .from("tax_invoice")
      .select("id, sale_id, nts_confirm_num, state, provider, total_krw, write_date, buyer, resolved_at, sale:sale!tax_invoice_sale_id_fkey(doc_no, deleted_at)")
      .eq("book", book)
      .is("deleted_at", null),
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
  const allInvoices = (invRes.data ?? []) as unknown as Array<{
    id: string;
    sale_id: string;
    nts_confirm_num: string | null;
    state: string;
    provider: string;
    total_krw: number;
    write_date: string;
    buyer: { corpNum?: string } | null;
    resolved_at: string | null;
    sale: { doc_no: string; deleted_at: string | null } | null;
  }>;
  const invoices = allInvoices
    .filter((i) => !i.sale?.deleted_at && i.state !== "cancelled")
    .map((i) => ({ id: i.id, sale_id: i.sale_id, nts_confirm_num: i.nts_confirm_num, state: i.state, provider: i.provider, total_krw: i.total_krw }));
  // 지운 매출의 계산서 — 정리됨(발행취소·수정발행 표시) 여부와 함께. 승인번호가 없으면 거래처·금액·작성일로 찾는다.
  const deletedSaleInvoices: DeletedSaleInvoice[] = allInvoices
    .filter((i) => !!i.sale?.deleted_at)
    .map((i) => ({
      id: i.id,
      sale_id: i.sale_id,
      doc_no: i.sale?.doc_no ?? "",
      nts_confirm_num: i.nts_confirm_num,
      resolved: i.state === "cancelled" || !!i.resolved_at,
      cancelled: i.state === "cancelled",
      buyer_biz: bizKey(i.buyer?.corpNum),
      total_krw: Number(i.total_krw ?? 0),
      write_date: String(i.write_date),
    }));
  const partners = (partnersRes.data ?? []) as Array<{ id: string; name: string; business_no: string | null }>;
  return { sales, invoices, deletedSaleInvoices, partners };
}

const isDocSale = (s: SaleLite) => s.is_documented && ["tax_invoice_electronic", "tax_invoice_paper", "invoice"].includes(s.tax_doc_type);

type DeletedSaleInvoice = {
  id: string;
  sale_id: string;
  doc_no: string;
  nts_confirm_num: string | null;
  resolved: boolean;
  cancelled: boolean;
  buyer_biz: string;
  total_krw: number;
  write_date: string;
};

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
  const { sales, invoices, deletedSaleInvoices, partners } = await loadSystem(sb, book, dates[0], dates[dates.length - 1]);

  const invByNts = new Map<string, (typeof invoices)[number]>();
  for (const i of invoices) if (i.nts_confirm_num) invByNts.set(normalizeNts(i.nts_confirm_num), i);
  const deletedInvByNts = new Map(
    deletedSaleInvoices.filter((i) => i.nts_confirm_num).map((i) => [normalizeNts(i.nts_confirm_num), i]),
  );
  // 승인번호 없이 남은 지운 매출 계산서(발행 직후 지운 팝빌 건·시스템 밖 발행분, 발행취소 제외) — 승인번호가 정확히 맞는
  // 행(지운 매출·살아 있는 매출)을 뺀 나머지에서 거래처·금액·작성일(±31일)이 맞는 행이 딱 하나일 때만 짝짓는다.
  // 여럿이면 사람이 고르게 후보로만 둔다(대체 매출의 진짜 계산서를 지운 매출 것으로 잘못 묶지 않게).
  const daysApart = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
  const fallbackByNts = new Map<string, { orphans: DeletedSaleInvoice[] }>();
  const orphanRowCount = new Map<string, number>();
  for (const o of deletedSaleInvoices.filter((i) => !i.nts_confirm_num && !i.cancelled && i.buyer_biz)) {
    for (const r of sellRows) {
      const ins = r.insert;
      const rowNts = ins.nts_confirm_num;
      const prevStatus = existingStatus.get(rowNts);
      if (prevStatus && ["matched", "linked", "ignored"].includes(prevStatus)) continue;
      if (deletedInvByNts.has(rowNts) || invByNts.has(rowNts)) continue;
      if ((ins.modify_code ?? 0) !== 0 || ins.total_amount <= 0) continue;
      if (bizKey(ins.invoicee.biz_no) !== o.buyer_biz) continue;
      if (Math.abs(o.total_krw - ins.total_amount) >= 1 || daysApart(o.write_date, ins.write_date) > 31) continue;
      const hit = fallbackByNts.get(rowNts) ?? { orphans: [] };
      hit.orphans.push(o);
      fallbackByNts.set(rowNts, hit);
      orphanRowCount.set(o.id, (orphanRowCount.get(o.id) ?? 0) + 1);
    }
  }
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
    // 지운 매출의 계산서(승인번호 일치) — 자동 연결·매출 생성 없이: 정리 끝났으면 '무시', 아니면 사람이 본다.
    const deletedInv = deletedInvByNts.get(nts);
    if (deletedInv) {
      decisions.push({
        ...base,
        case: "D_deleted",
        status: deletedInv.resolved ? "ignored" : "candidate",
        saleId: deletedInv.sale_id,
        saleDocNo: deletedInv.doc_no,
        taxInvoiceId: deletedInv.id,
        note: deletedInv.resolved
          ? `지운 매출 ${deletedInv.doc_no}의 계산서 — 정리 완료(수정발행·발행취소)`
          : `지운 매출 ${deletedInv.doc_no}의 계산서 — 수정세금계산서(−)·대체 매출 확인(자동 처리 안 함)`,
      });
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
    // 승인번호 없는 지운 매출 계산서와 거래처·금액·작성일이 맞음 — 서로 하나씩일 때만 묶고, 아니면 후보로.
    const fb = fallbackByNts.get(nts);
    if (fb) {
      const o = fb.orphans[0];
      if (fb.orphans.length === 1 && orphanRowCount.get(o.id) === 1) {
        decisions.push({
          ...base,
          case: "D_deleted",
          status: o.resolved ? "ignored" : "candidate",
          saleId: o.sale_id,
          saleDocNo: o.doc_no,
          taxInvoiceId: o.id,
          note: `지운 매출 ${o.doc_no}의 계산서(승인번호 없이 거래처·금액·작성일로 찾음) — ${o.resolved ? "정리 완료" : "수정세금계산서(−)·대체 매출 확인"}`,
        });
      } else {
        decisions.push({
          ...base,
          case: "D_deleted",
          status: "candidate",
          note: `지운 매출 ${[...new Set(fb.orphans.map((x) => x.doc_no))].join(", ")}의 계산서일 수 있음 — 같은 거래처·금액 후보가 여럿, 확인 필요(자동 처리 안 함)`,
        });
      }
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
    const daysBetween = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
    const partnerForCreate: Decision["partnerForCreate"] = {
      partner_id: byBiz[0]?.id ?? byName[0]?.id ?? null,
      name: party.name ?? party.biz_no,
      isNew: byBiz.length === 0 && byName.length === 0,
    };
    // 중복 가드: 같은 거래처에 같은 금액 매출이 180일 안에 이미 있으면(발행됐든 아니든) 새로 만들지 않는다 — 수정분 뒤 재발행·이중 발급 의심
    // (이번 파일의 다른 계산서로 이미 짝지어진 매출도 포함 — 팝빌 발행 후 수정분으로 지우고 홈택스에서 재발행한 사례가 그렇다)
    const dup = cands.find((s) => Math.abs(s.total_krw - ins.total_amount) < 1 && (saleHasInvoice.has(s.id) || coveredSaleIds.has(s.id) || exact.length === 0) && daysBetween(s.ordered_on, ins.write_date) <= 180);
    if (exact.length === 0 && dup) {
      decisions.push({ ...base, case: "D_dup", status: "candidate", partnerFix, candidates: [toCand(dup)], note: `같은 금액 매출 ${dup.doc_no}(${saleHasInvoice.has(dup.id) ? "발행됨" : "미발행"}) 있음 — 재발행·이중 발급 의심, 생성 안 함` });
      continue;
    }
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
    // X 후보 [결정 §13]: 같은 거래처의 미발행 매출 중 작성일 ±10일 · 금액 차이 10% 또는 10만 원 이내일 때만. 그 밖은 누락(N).
    const tolerance = Math.max(ins.total_amount * 0.1, 100_000);
    const near = cands
      .filter((s) => !saleHasInvoice.has(s.id) && !coveredSaleIds.has(s.id) && daysBetween(s.ordered_on, ins.write_date) <= 10 && Math.abs(s.total_krw - ins.total_amount) <= tolerance)
      .sort((a, b) => Math.abs(a.total_krw - ins.total_amount) - Math.abs(b.total_krw - ins.total_amount));
    if (near.length > 0) {
      decisions.push({
        ...base,
        case: "X_amount",
        status: "candidate",
        partnerFix,
        candidates: near.slice(0, 5).map(toCand),
        note: `거래처 있음 · 금액 불일치(가장 가까운 ${near[0].doc_no} ${near[0].total_krw.toLocaleString("ko-KR")}) → --align 으로 계산서 금액에 맞춤`,
      });
      continue;
    }
    decisions.push({
      ...base,
      case: "N_missing",
      status: "unmatched",
      partnerFix,
      partnerForCreate,
      note: partnerForCreate.isNew ? "시스템에 거래처·매출 없음 → 거래처 생성 + 매출 생성" : "거래처는 있으나 해당 매출 없음 → 매출 생성",
    });
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
  const createdPartners = new Map<string, string>(); // 이번 실행에서 만든 거래처(사업자번호 → id)
  for (const d of report.decisions) {
    if (d.case === "S_skip") continue;
    const row = byNts.get(d.nts);
    if (!row) continue;
    const prev = existingMap.get(d.nts);
    const prevState = prev
      ? { match_status: String(prev.match_status), sale_id: (prev.sale_id as string | null) ?? null, tax_invoice_id: (prev.tax_invoice_id as string | null) ?? null, notes: (prev.notes as string | null) ?? null }
      : { match_status: "unmatched", sale_id: null, tax_invoice_id: null, notes: null };

    let taxInvoiceId = d.taxInvoiceId ?? null;
    let createdSaleId: string | null = null;
    let createdDocNo: string | null = null;
    if (d.case === "N_missing" && d.partnerForCreate) {
      const ins = row.insert;
      // 거래처 — 기존 id 또는 신규(사업자번호·상호·대표자·이메일; 주소·전화는 엑셀에 없음).
      // 같은 파일에 같은 거래처 계산서가 여러 장이면 한 번만 만든다(이번 실행에서 만든 것 + DB 재조회).
      let partnerId = d.partnerForCreate.partner_id;
      const bizKeyOf = ins.invoicee.biz_no || `name:${ins.invoicee.name ?? ""}`;
      if (!partnerId && createdPartners.has(bizKeyOf)) partnerId = createdPartners.get(bizKeyOf)!;
      if (!partnerId && ins.invoicee.biz_no) {
        const { data: found } = await sb.from("partner").select("id").eq("business_no", ins.invoicee.biz_no).is("deleted_at", null).order("created_at").limit(1).maybeSingle();
        if (found) partnerId = String(found.id);
      }
      if (!partnerId) {
        const { data: p, error: pErr } = await sb
          .from("partner")
          .insert({ name: ins.invoicee.name ?? ins.invoicee.biz_no, business_no: ins.invoicee.biz_no || null, representative: ins.invoicee.ceo, email: ins.invoicee.email, notes: `홈택스 수집본에서 자동 생성 (${ins.write_date} 계산서)` })
          .select("id")
          .single();
        if (pErr || !p) throw new Error(`거래처 생성 실패(${ins.invoicee.name}): ${pErr?.message}`);
        partnerId = String(p.id);
        createdPartners.set(bizKeyOf, partnerId);
        actions.push({ type: "partner_created", partner_id: partnerId, name: ins.invoicee.name ?? "" });
        log(`거래처 생성: ${ins.invoicee.name} (${ins.invoicee.biz_no})`);
      }
      const created = await createSaleFromInvoice(sb, book, ins, partnerId, log);
      createdSaleId = created.saleId;
      createdDocNo = created.docNo;
      actions.push({ type: "sale_created", sale_id: created.saleId, doc_no: created.docNo });
    }
    const linkSaleId = createdSaleId ?? (d.case === "A_link" ? (d.saleId ?? null) : null);
    if (linkSaleId) {
      // 발행 기록 생성 — 기존 RPC(provider hometax). 이전 sale 발행 필드를 롤백용으로 보관.
      const { data: saleBefore } = await sb.from("sale").select("tax_invoice_issued_on, tax_doc_no").eq("id", linkSaleId).single();
      const ins = row.insert;
      const { data: tiId, error } = await sb.rpc("record_sale_tax_invoice", {
        p_sale_id: linkSaleId,
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
        sale_id: linkSaleId,
        prev_sale: { tax_invoice_issued_on: (saleBefore?.tax_invoice_issued_on as string | null) ?? null, tax_doc_no: (saleBefore?.tax_doc_no as string | null) ?? null },
      });
      const body = createdSaleId
        ? `[홈택스 대조] 홈택스 직접 발행 계산서로 매출 생성 — 승인번호 ${d.nts}, 작성일 ${ins.write_date}, 합계 ${ins.total_amount.toLocaleString("ko-KR")}원, 품목 "${ins.item_summary ?? ""}" · 품목·중량·현장 미정 → 수정에서 채울 것 (팝빌 엑셀 ${ins.write_date.slice(0, 7)})`
        : `[홈택스 대조] 홈택스 직접 발행분과 연결 — 승인번호 ${d.nts}, 작성일 ${ins.write_date}, 합계 ${ins.total_amount.toLocaleString("ko-KR")}원 (팝빌 엑셀 ${ins.write_date.slice(0, 7)})`;
      const { data: memo, error: mErr } = await sb.from("sale_memo").insert({ sale_id: linkSaleId, body }).select("id").single();
      if (!mErr && memo) actions.push({ type: "memo_created", memo_id: String(memo.id), sale_id: linkSaleId });
      log(createdSaleId ? `N 생성: ${createdDocNo} ← ${d.nts} (${ins.invoicee.name} ${ins.total_amount.toLocaleString("ko-KR")})` : `A 연결: ${d.saleDocNo} ← ${d.nts}`);
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
    const finalStatus: HometaxMatchStatus = createdSaleId ? "linked" : d.status;
    const { error: uErr } = await sb
      .from("hometax_invoice")
      .update({
        match_status: finalStatus,
        sale_id: createdSaleId ?? d.saleId ?? null,
        tax_invoice_id: taxInvoiceId,
        matched_at: ["matched", "linked"].includes(finalStatus) ? new Date().toISOString() : null,
        notes: createdSaleId ? `매출 ${createdDocNo} 생성(홈택스 직접 발행분) · 품목 미정` : notes,
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
      // 그 뒤 매출·매입 삭제가 이 수집본을 옮기거나 '무시(삭제)'로 바꿨으면 되돌리지 않는다 — 대상의 계산서 연결이 풀리거나
      // 지운 거래가 다음 대사에서 되살아나지 않게(0095).
      const { data: cur } = await sb.from("hometax_invoice").select("notes, ignore_reason, resolved_at").eq("nts_confirm_num", a.nts).maybeSingle();
      const touched = /삭제\(|이관\(/.test(`${cur?.notes ?? ""} ${cur?.ignore_reason ?? ""}`) || !!cur?.resolved_at;
      if (touched) {
        log(`수집본 ${a.nts} 는 그 뒤 거래 삭제로 바뀌어 남김`);
        continue;
      }
      await sb.from("hometax_invoice").update({ ...a.prev, purchase_id: null, receipt_id: null, matched_at: null }).eq("nts_confirm_num", a.nts);
    } else if (a.type === "memo_created") {
      await sb.from("sale_memo").delete().eq("id", a.memo_id);
    } else if (a.type === "tax_invoice_created") {
      // 우리가 만든 hometax 기록이므로 hard delete 가 맞다(취소 상태로 남기면 1:1 유니크·화면에 흔적이 남는다)
      // 그 뒤 매출 삭제로 다른 매출에 옮겨졌거나, 매출을 지우며 국세청 기록으로 남긴 기록이면 건드리지 않는다.
      const { data: ti } = await sb.from("tax_invoice").select("sale_id, sale:sale!tax_invoice_sale_id_fkey(deleted_at)").eq("id", a.tax_invoice_id).maybeSingle();
      if (!ti) {
        log(`발행 기록 ${a.tax_invoice_id} 는 이미 없음`);
        continue;
      }
      if (ti.sale_id !== a.sale_id || (ti.sale as { deleted_at?: string | null } | null)?.deleted_at) {
        log(`발행 기록 ${a.tax_invoice_id} 는 다른 매출로 옮겨졌거나 지운 매출의 국세청 기록이라 남김`);
        continue;
      }
      const { error: delErr } = await sb.from("tax_invoice").delete().eq("id", a.tax_invoice_id).eq("provider", "hometax");
      if (delErr) throw new Error(`발행 기록 삭제 실패(${a.tax_invoice_id}): ${delErr.message}`);
      await sb.from("sale").update({ tax_invoice_issued_on: a.prev_sale.tax_invoice_issued_on, tax_doc_no: a.prev_sale.tax_doc_no }).eq("id", a.sale_id);
      log(`발행 기록 삭제·매출 필드 복원: ${a.sale_id}`);
    } else if (a.type === "purchase_created") {
      // 그 뒤 지웠거나(매입 삭제가 정리함) 결제·다른 연결이 붙은 매입은 남긴다. 헤더만 지우고 라인은 CASCADE —
      // 라인부터 지웠다가 헤더 삭제가 실패해 라인 없는 매입이 남지 않게.
      const { data: pur } = await sb.from("purchase").select("deleted_at").eq("id", a.purchase_id).maybeSingle();
      const { count: pays } = await sb.from("bank_transaction").select("id", { count: "exact", head: true }).eq("purchase_id", a.purchase_id);
      if (!pur) {
        log(`생성 매입 ${a.doc_no} 는 이미 없음`);
        continue;
      }
      if (pur.deleted_at || (pays ?? 0) > 0) {
        log(`생성 매입 ${a.doc_no} 는 그 뒤 삭제됐거나 결제가 붙어 남김`);
        continue;
      }
      const { error } = await sb.from("purchase").delete().eq("id", a.purchase_id).eq("origin", "hometax");
      if (error) throw new Error(`생성 매입 삭제 실패(${a.doc_no}): ${error.message}`);
      log(`생성 매입 삭제: ${a.doc_no}`);
    } else if (a.type === "purchase_linked") {
      const { data: pur } = await sb.from("purchase").select("deleted_at").eq("id", a.purchase_id).maybeSingle();
      if (!pur || pur.deleted_at) {
        log(`연결했던 매입 ${a.purchase_id} 는 그 뒤 삭제돼 남김`);
        continue;
      }
      await sb.from("purchase").update(a.prev).eq("id", a.purchase_id);
    } else if (a.type === "purchase_memo_created") {
      await sb.from("purchase_memo").delete().eq("id", a.memo_id);
    } else if (a.type === "invoice_notes") {
      await sb.from("hometax_invoice").update({ notes: a.prev_notes }).eq("nts_confirm_num", a.nts);
    } else if (a.type === "receipt_created") {
      await sb.from("receipt").delete().eq("id", a.receipt_id).eq("origin", "hometax");
    } else if (a.type === "partner_kind_set") {
      await sb.from("partner").update({ supply_kind: a.prev }).eq("id", a.partner_id);
    } else if (a.type === "sale_created") {
      // 우리가 만든 매출 — 발행 기록·메모는 앞선 액션에서 지워졌으므로 매출만 hard delete(라인은 CASCADE).
      // 그 사이 수금(입금)이 붙었으면 FK 로 실패한다 — 라인만 지워진 매출이 남지 않게 라인을 먼저 지우지 않는다.
      const { error } = await sb.from("sale").delete().eq("id", a.sale_id).eq("origin", "hometax");
      if (error) throw new Error(`생성 매출 삭제 실패(${a.doc_no}): ${error.message}`);
      log(`생성 매출 삭제: ${a.doc_no}`);
    } else if (a.type === "partner_created") {
      const { count } = await sb.from("sale").select("id", { count: "exact", head: true }).eq("partner_id", a.partner_id);
      const { count: pc } = await sb.from("purchase").select("id", { count: "exact", head: true }).eq("partner_id", a.partner_id);
      if ((count ?? 0) === 0 && (pc ?? 0) === 0) {
        await sb.from("partner").delete().eq("id", a.partner_id);
        log(`생성 거래처 삭제: ${a.name}`);
      } else log(`거래처 ${a.name} 는 다른 거래가 있어 남김`);
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
): Promise<{ actions: Action[]; diff: number; prevReceived: number; skipped?: boolean } | null> {
  const { data: bts } = await sb.from("bank_transaction").select("id, txn_on, amount_krw").eq("sale_id", saleId).is("deleted_at", null).gt("amount_krw", 0).order("txn_on", { ascending: false }).order("created_at", { ascending: false });
  const rows = (bts ?? []) as Array<{ id: string; txn_on: string; amount_krw: number }>;
  if (rows.length === 0) return null;
  const received = rows.reduce((a, r) => a + Number(r.amount_krw), 0);
  const diff = totalKrw - received;
  if (diff === 0) return { actions: [], diff: 0, prevReceived: received };
  const last = rows[0];
  const next = Number(last.amount_krw) + diff;
  // 입금이 여러 건(지운 매출에서 옮겨 온 수금)이면 최근 1건만 고쳐서는 0 이하가 될 수 있다 — 그땐 고치지 않고 사람이 본다.
  if (next <= 0) {
    log(`입금 기록 자동 맞춤 생략 — 최근 입금 ${Number(last.amount_krw).toLocaleString("ko-KR")}원에 차액 ${diff.toLocaleString("ko-KR")}원을 더하면 0 이하`);
    return { actions: [], diff, prevReceived: received, skipped: true };
  }
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
  // 쓰기 전에 — 이 계산서가 이미 다른 매출(지운 매출 포함)에 연결·기록돼 있으면 멈춘다(반쪽 반영·같은 승인번호 이중 기록 방지).
  if (inv.sale_id && inv.sale_id !== input.saleId) {
    throw new Error(`이 수집본은 이미 다른 매출에 연결돼 있습니다(${inv.match_status}) — 지운 매출의 계산서면 세금계산서 화면 '정리 필요'에서 먼저 처리하세요.`);
  }
  if (inv.tax_invoice_id) {
    const { data: linked } = await sb.from("tax_invoice").select("sale_id, state").eq("id", inv.tax_invoice_id).maybeSingle();
    if (linked && linked.sale_id !== input.saleId && linked.state !== "cancelled") {
      throw new Error("이 수집본은 이미 다른 매출의 발행 기록과 묶여 있습니다 — 그 기록을 먼저 정리하세요.");
    }
  }
  const { data: bookInvoices } = await sb.from("tax_invoice").select("sale_id, state, mgt_key, nts_confirm_num").eq("book", sale.book).is("deleted_at", null);
  const ntsKey = normalizeNts(input.nts);
  const elsewhere = (bookInvoices ?? []).find(
    (t) =>
      t.sale_id !== input.saleId &&
      ((t.state !== "cancelled" && !!t.nts_confirm_num && normalizeNts(t.nts_confirm_num) === ntsKey) || t.mgt_key === `hometax-${input.nts}`),
  );
  if (elsewhere) throw new Error(`같은 승인번호의 발행 기록이 다른 매출에 있습니다(${elsewhere.mgt_key}) — 먼저 그 기록을 정리하세요.`);

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
    if (pay?.skipped) {
      paymentNote = ` · 입금 기록(${won(pay.prevReceived)})은 여러 건이라 자동으로 못 맞춤 — 확인 필요`;
    } else if (pay && pay.diff !== 0) {
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

// ------------------------------------------------------------
// 누락(N) — 홈택스 직접 발행 계산서로 매출 생성 (사장 결정 2026-10-26, 기획 §14)
//   주문일·납품일 = 작성일, 납품완료, 자료거래, 금액 라인 1줄(철제 직접입력 "홈택스 계산서분 — 품목", 중량 없음 → 재고 미반영 = 품목 미정),
//   수금예정일 = 작성일 + 30(거래처 기본조건 컬럼이 없음), origin='hometax' 로 목록에 표시. 발행 기록·메모는 호출자가 붙인다.
// ------------------------------------------------------------
const STEEL_CUSTOM_ITEM_ID = "00000000-0000-0000-0000-0000000057ee";
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 86_400_000).toISOString().slice(0, 10);

async function nextSaleDocNo(sb: SupabaseClient, orderedOn: string): Promise<string> {
  // 앱 generateDocNo 와 같은 규칙(책 무관, 일자별 순번). 충돌 시 호출자가 재시도.
  const { count } = await sb.from("sale").select("id", { count: "exact", head: true }).eq("ordered_on", orderedOn);
  return `${orderedOn.replace(/-/g, "")}-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

export async function createSaleFromInvoice(
  sb: SupabaseClient,
  book: Book,
  ins: HometaxInvoiceInsert,
  partnerId: string,
  log: (m: string) => void = () => {},
): Promise<{ saleId: string; docNo: string }> {
  const isFree = ins.kind === "invoice";
  const header = {
    book,
    partner_id: partnerId,
    site_id: "",
    site_name: "",
    ordered_on: ins.write_date,
    delivered_on: ins.write_date,
    is_documented: true,
    tax_doc_type: isFree ? "invoice" : "tax_invoice_electronic",
    vat_type: isFree ? "exempt" : "standard_10",
    vat_rate: isFree ? 0 : 10,
    subtotal_krw: ins.supply_amount,
    vat_krw: ins.tax_amount,
    total_krw: ins.total_amount,
    payment_due_on: addDays(ins.write_date, 30),
    settled_on: "",
    status: "delivered",
    notes: `홈택스 직접 발행 계산서(승인 ${ins.nts_confirm_num})로 자동 생성 — 품목·중량·현장은 수정에서 채울 것`,
  };
  const lines = [
    {
      item_id: STEEL_CUSTOM_ITEM_ID,
      unit: "ea",
      qty: 1,
      unit_price_krw: ins.supply_amount,
      weight_kg: "",
      line_subtotal_krw: ins.supply_amount,
      display_name: `홈택스 계산서분 — ${ins.item_summary ?? "품목 미정"}`,
    },
  ];
  let saleId: string | null = null;
  let docNo = "";
  for (let attempt = 0; attempt < 3 && !saleId; attempt++) {
    docNo = await nextSaleDocNo(sb, ins.write_date);
    const { data, error } = await sb.rpc("create_sale_with_lines", { p_sale: { ...header, doc_no: docNo }, p_lines: lines });
    if (!error) saleId = String(data);
    else if (!/sale_doc_no_key|duplicate key/.test(error.message)) throw new Error(`매출 생성 실패(${ins.invoicee.name}): ${error.message}`);
  }
  if (!saleId) throw new Error(`매출 번호 충돌로 생성 실패: ${docNo}`);
  const { error: oErr } = await sb.from("sale").update({ origin: "hometax", origin_ref: ins.nts_confirm_num }).eq("id", saleId);
  if (oErr) log(`  origin 표시 실패(${docNo}): ${oErr.message}`);
  return { saleId, docNo };
}
