/**
 * 홈택스 매입 수집본 대조 — 기획 §15 (사장 결정 2026-10-27).
 *   분류 = 거래처(partner.supply_kind): inventory → 매입 생성 / expense → 영수증(비용) 생성 / NULL → 분류 대기(사람이 한 번 정하면 다음부터 자동).
 *   기존 매입이 있으면(매입처·금액 일치·미증빙·±10일) 생성 대신 연결(tax_doc_no). 같은 금액 매입이 180일 안에 있으면 중복 가드.
 *   취소·재발행 묶기(§3.2·§15.2-7, 2026-10-28): 같은 공급자·같은 절대 금액·작성일 ±10일 안의 (+)당초(매입에 linked)·(−)수정·(+)재발행을 한 그룹으로.
 *     순합계 = 당초 → 자동(P_group): 세 장 모두 그 매입에 linked, 증빙 번호·수취일을 재발행 장으로 교체, 메모. 순합계 ≠ 당초 → D_modify 후보 + 차액 표시.
 *     재발행이 아직 없으면 '수정(−) 대기' 후보.
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
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${won(Math.abs(n))}`;
/** 승인번호 끝 6자리 — 사람이 알아보는 짧은 표시(화면·대조표와 같은 규칙). */
export const ntsTail = (nts: string) => `…${normalizeNts(nts).slice(-6)}`;

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

export type BuyGroupRole = "cancel" | "reissue";
/** 취소·재발행 묶음 — 당초(매입에 linked) + (−)수정 + (+)재발행. 순합계가 당초와 같으면 자동 처리. */
export type BuyGroup = {
  origNts: string; // 당초 승인번호(정규화) = 매입의 현재 tax_doc_no
  origDate: string; // 당초 작성일(수집본에 있으면) · 없으면 매입 수취일·발주일
  origTotal: number;
  purchaseId: string;
  purchaseDocNo: string;
  members: Array<{ nts: string; write_date: string; total: number; role: BuyGroupRole; fromDb: boolean }>;
  net: number; // 순합계 = 당초 + Σ(−) + Σ재발행
  diff: number; // net − 당초
  reissue: { nts: string; write_date: string } | null; // 증빙 번호 교체 대상 = 가장 늦은 재발행 장
  auto: boolean; // 재발행 있고 순합계 = 당초
};

export type BuyDecision = {
  nts: string;
  rowNo: number;
  write_date: string;
  supplierName: string | null;
  supplierBiz: string;
  total: number;
  itemSummary: string | null;
  isModify: boolean;
  case: "P_link" | "P_nts" | "P_group" | "P_create" | "R_create" | "K_pending" | "D_modify" | "D_dup" | "D_deleted" | "S_skip";
  status: HometaxMatchStatus;
  note: string;
  partner: PartnerLite | null; // 찾은 거래처(없으면 null → 생성 대상)
  purchaseId?: string;
  purchaseDocNo?: string;
  suggestion?: SupplyKind; // 대기 행의 제안
  candidates?: Array<{ doc_no: string; total: number; ordered_on: string; paid: boolean; has_doc: boolean }>;
  group?: BuyGroup; // 취소·재발행 묶음(P_group 자동 / D_modify 후보 모두)
  groupRole?: BuyGroupRole;
  fromDb?: boolean; // 엑셀엔 없고 수집본(DB)에만 있던 (−) 후보가 이번 재발행과 묶인 경우 — applyBuy 는 결정 값만으로 처리
};

/** 대조표·로그용 한 줄: "수정(−) · 당초 …29ab · 순합계 1,537,800 (차액 +0)". */
export function describeGroup(d: Pick<BuyDecision, "group" | "groupRole">): string {
  const g = d.group;
  if (!g) return "";
  const role = d.groupRole === "cancel" ? "수정(−)" : d.groupRole === "reissue" ? "재발행" : "";
  const diff = Math.abs(g.diff) < 1 ? "" : ` (차액 ${signed(g.diff)})`;
  return `${role} · 당초 ${ntsTail(g.origNts)} · 순합계 ${won(g.net)}${diff}`;
}

export type BuyReport = { decisions: BuyDecision[]; summary: Record<string, number> };

type PurchaseNts = { id: string; doc_no: string; tax_doc_no: string | null; origin_ref: string | null };
type HometaxLite = { nts: string; write_date: string; total: number; isModify: boolean; match_status: string; purchase_id: string | null; biz: string; name: string | null };

async function loadSystem(sb: SupabaseClient, book: Book, from: string, to: string) {
  const pad = (d: string, days: number) => addDays(d, days);
  const [pRes, partnersRes, liveNtsRes, deletedRes, htRes] = await Promise.all([
    sb
      .from("purchase")
      .select("id, doc_no, ordered_on, total_krw, is_documented, tax_doc_no, status, paid_on, partner_id")
      .eq("book", book)
      .is("deleted_at", null) // purchase_status 에는 취소가 없다(scrapped 는 재고 폐기라 매입 자체는 유효)
      .gte("ordered_on", pad(from, -180))
      .lte("ordered_on", pad(to, 31)),
    sb.from("partner").select("id, name, business_no, supply_kind").is("deleted_at", null),
    // 승인번호를 이미 가진 살아 있는 매입(기간 무관) — 옮겨 받은 계산서도 여기서 잡는다(0095).
    sb.from("purchase").select("id, doc_no, tax_doc_no, origin_ref").eq("book", book).is("deleted_at", null).or("tax_doc_no.not.is.null,origin_ref.not.is.null"),
    // 지운 매입 — 그 계산서로 매입을 되살리지 않게(0095).
    sb.from("purchase").select("id, doc_no, tax_doc_no, origin_ref").eq("book", book).not("deleted_at", "is", null),
    // 수집본 매입 행(±10일 여유) — 취소·재발행 묶기의 당초 작성일, 엑셀엔 없는데 DB 에 남은 (−) 후보.
    sb
      .from("hometax_invoice")
      .select("nts_confirm_num, write_date, total_amount, modify_code, match_status, purchase_id, supplier")
      .eq("book", book)
      .eq("direction", "buy")
      .gte("write_date", pad(from, -10))
      .lte("write_date", pad(to, 10)),
  ]);
  if (pRes.error) throw new Error(`매입 조회 실패: ${pRes.error.message}`);
  if (partnersRes.error) throw new Error(`거래처 조회 실패: ${partnersRes.error.message}`);
  if (liveNtsRes.error) throw new Error(`매입 승인번호 조회 실패: ${liveNtsRes.error.message}`);
  if (deletedRes.error) throw new Error(`지운 매입 조회 실패: ${deletedRes.error.message}`);
  if (htRes.error) throw new Error(`수집본 매입 조회 실패: ${htRes.error.message}`);
  const byNts = (rows: PurchaseNts[]) => {
    const m = new Map<string, PurchaseNts>();
    for (const r of rows) {
      for (const v of [r.tax_doc_no, r.origin_ref]) {
        const k = normalizeNts(v);
        if (k && !m.has(k)) m.set(k, r);
      }
    }
    return m;
  };
  return {
    purchases: (pRes.data ?? []).map((r) => ({ ...r, total_krw: Number(r.total_krw ?? 0) })) as PurchaseLite[],
    partners: (partnersRes.data ?? []) as PartnerLite[],
    liveByNts: byNts((liveNtsRes.data ?? []) as PurchaseNts[]),
    deletedByNts: byNts((deletedRes.data ?? []) as PurchaseNts[]),
    hometaxRows: (htRes.data ?? []).map((h) => {
      const sup = (h.supplier ?? {}) as { biz_no?: string; name?: string | null };
      return {
        nts: normalizeNts(h.nts_confirm_num),
        write_date: String(h.write_date),
        total: Number(h.total_amount ?? 0),
        isModify: (Number(h.modify_code ?? 0) || 0) !== 0,
        match_status: String(h.match_status),
        purchase_id: (h.purchase_id as string | null) ?? null,
        biz: bizKey(sup.biz_no),
        name: sup.name ?? null,
      } satisfies HometaxLite;
    }),
  };
}

/** 묶기 입력 — 엑셀 행 또는 수집본(DB) 행을 같은 모양으로. */
export type GroupMember = { nts: string; write_date: string; total: number; partnerId: string | null; isModify: boolean; fromDb: boolean };
/** 묶기의 당초 축 = 승인번호를 가진 살아 있는 매입. origNts 는 정규화된 tax_doc_no. */
export type GroupAnchor = { purchaseId: string; docNo: string; partnerId: string | null; total: number; origNts: string; origDate: string };

/**
 * 취소·재발행 묶기(순수 함수).
 *   (−)수정 장 N 마다: 같은 거래처·|금액| 일치·당초 작성일 ±10일인 증빙 매입(앵커) 중 날짜가 가장 가까운 것 → 그 매입의 그룹에 넣는다.
 *   재발행: ① 같은 거래처·±10일·당초와 같은 금액인 (+) 장(일반·수정 불문) ② ①로도 순합계가 안 맞으면 (+)수정 장(금액 변동·환입).
 *   같은 공급자의 다른 금액 '일반' 장은 끌어오지 않는다(월 여러 장 끊는 거래처의 정상 계산서를 묶어 버리지 않게).
 */
export function groupModifyInvoices(cancels: GroupMember[], pluses: GroupMember[], anchors: GroupAnchor[]): { groups: BuyGroup[]; byNts: Map<string, { group: BuyGroup; role: BuyGroupRole; member: GroupMember }> } {
  const groups = new Map<string, { g: BuyGroup; partnerId: string | null }>();
  const byNts = new Map<string, { group: BuyGroup; role: BuyGroupRole; member: GroupMember }>();
  const join = (entry: { g: BuyGroup; partnerId: string | null }, m: GroupMember, role: BuyGroupRole) => {
    entry.g.members.push({ nts: m.nts, write_date: m.write_date, total: m.total, role, fromDb: m.fromDb });
    entry.g.net += m.total;
    byNts.set(m.nts, { group: entry.g, role, member: m });
  };
  for (const n of [...cancels].sort((a, b) => a.write_date.localeCompare(b.write_date) || a.nts.localeCompare(b.nts))) {
    if (!n.partnerId || n.total >= 0 || byNts.has(n.nts)) continue;
    const cands = anchors
      .filter((a) => a.partnerId === n.partnerId && a.origNts !== n.nts && Math.abs(a.total - Math.abs(n.total)) < 1 && daysBetween(a.origDate, n.write_date) <= 10)
      .sort((a, b) => daysBetween(a.origDate, n.write_date) - daysBetween(b.origDate, n.write_date));
    const a = cands[0];
    if (!a) continue;
    let entry = groups.get(a.purchaseId);
    if (!entry) {
      entry = { g: { origNts: a.origNts, origDate: a.origDate, origTotal: a.total, purchaseId: a.purchaseId, purchaseDocNo: a.docNo, members: [], net: a.total, diff: 0, reissue: null, auto: false }, partnerId: a.partnerId };
      groups.set(a.purchaseId, entry);
    }
    join(entry, n, "cancel");
  }
  for (const entry of groups.values()) {
    const { g } = entry;
    const pool = pluses.filter((p) => !byNts.has(p.nts) && p.partnerId === entry.partnerId && p.total > 0 && p.nts !== g.origNts && daysBetween(g.origDate, p.write_date) <= 10);
    for (const p of pool) if (Math.abs(p.total - g.origTotal) < 1) join(entry, p, "reissue");
    if (Math.abs(g.net - g.origTotal) >= 1) for (const p of pool) if (p.isModify && !byNts.has(p.nts)) join(entry, p, "reissue");
    g.diff = g.net - g.origTotal;
    const reissues = g.members.filter((m) => m.role === "reissue").sort((a, b) => a.write_date.localeCompare(b.write_date) || a.nts.localeCompare(b.nts));
    g.reissue = reissues.length ? { nts: reissues[reissues.length - 1].nts, write_date: reissues[reissues.length - 1].write_date } : null;
    g.auto = reissues.length > 0 && Math.abs(g.diff) < 1;
  }
  return { groups: [...groups.values()].map((e) => e.g), byNts };
}

export async function planBuy(sb: SupabaseClient, book: Book, rows: ExcelInvoiceRow[], existingStatus: Map<string, HometaxMatchStatus>): Promise<BuyReport> {
  const buyRows = rows.filter((r) => r.insert.direction === "buy");
  const dates = buyRows.map((r) => r.insert.write_date).sort();
  if (dates.length === 0) return { decisions: [], summary: {} };
  const { purchases, partners, liveByNts, deletedByNts, hometaxRows } = await loadSystem(sb, book, dates[0], dates[dates.length - 1]);
  const byBiz = new Map<string, PartnerLite[]>();
  const byName = new Map<string, PartnerLite[]>();
  for (const p of partners) {
    const b = bizKey(p.business_no);
    if (b) byBiz.set(b, [...(byBiz.get(b) ?? []), p]);
    const n = nameKey(p.name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), p]);
  }
  const findPartner = (biz: string, name: string | null): PartnerLite | null => (byBiz.get(bizKey(biz)) ?? byName.get(nameKey(name)) ?? [])[0] ?? null;
  const covered = new Set<string>();
  const decisions: BuyDecision[] = [];
  const baseOf = (r: ExcelInvoiceRow) => {
    const ins = r.insert;
    return {
      nts: ins.nts_confirm_num,
      rowNo: r.rowNo,
      write_date: ins.write_date,
      supplierName: ins.supplier.name,
      supplierBiz: ins.supplier.biz_no,
      total: ins.total_amount,
      itemSummary: ins.item_summary,
      isModify: (ins.modify_code ?? 0) !== 0,
    };
  };

  // 1) 먼저 끝나는 행 — 이미 처리됨 · 승인번호를 가진 살아 있는 매입 · 지운 매입의 계산서. 묶기 대상에서 빠진다.
  const pre = new Map<string, BuyDecision>();
  for (const r of buyRows) {
    const ins = r.insert;
    const base = baseOf(r);
    const prev = existingStatus.get(ins.nts_confirm_num);
    if (prev && ["matched", "linked", "ignored"].includes(prev)) {
      pre.set(base.nts, { ...base, case: "S_skip", status: prev, note: `이미 처리됨(${prev})`, partner: null });
      continue;
    }
    // 승인번호가 이미 살아 있는 매입에 있음(삭제 때 옮겨 받은 계산서 등) → 그 매입에 연결만(매입은 고치지 않음).
    const holder = liveByNts.get(normalizeNts(ins.nts_confirm_num));
    if (holder) {
      covered.add(holder.id);
      pre.set(base.nts, { ...base, case: "P_nts", status: "linked", partner: null, purchaseId: holder.id, purchaseDocNo: holder.doc_no, note: `승인번호가 매입 ${holder.doc_no}에 이미 있음 → 연결` });
      continue;
    }
    // 지운 매입의 계산서 — 매입을 되살리지(P_create)·엉뚱한 매입에 붙이지(P_link) 않고 사람이 본다(홈택스 화면 정리 필요).
    const gone = deletedByNts.get(normalizeNts(ins.nts_confirm_num));
    if (gone) {
      pre.set(base.nts, { ...base, case: "D_deleted", status: "candidate", partner: null, purchaseId: gone.id, purchaseDocNo: gone.doc_no, note: `지운 매입 ${gone.doc_no}의 계산서 — 공급자 수정세금계산서(−)·대체 매입 확인(자동 처리 안 함)` });
    }
  }

  // 2) 취소·재발행 묶기 — 당초 축은 승인번호(tax_doc_no)를 가진 살아 있는 매입. 당초 작성일은 수집본에서, 없으면 수취일·발주일.
  const hometaxByNts = new Map(hometaxRows.map((h) => [h.nts, h]));
  const anchors: GroupAnchor[] = purchases
    .filter((p) => p.tax_doc_no && !covered.has(p.id))
    .map((p) => {
      const origNts = normalizeNts(p.tax_doc_no);
      return { purchaseId: p.id, docNo: p.doc_no, partnerId: p.partner_id, total: p.total_krw, origNts, origDate: hometaxByNts.get(origNts)?.write_date ?? p.ordered_on };
    });
  const eligible = buyRows.filter((r) => !pre.has(r.insert.nts_confirm_num));
  const toMember = (r: ExcelInvoiceRow): GroupMember => ({ nts: r.insert.nts_confirm_num, write_date: r.insert.write_date, total: r.insert.total_amount, partnerId: findPartner(r.insert.supplier.biz_no, r.insert.supplier.name)?.id ?? null, isModify: (r.insert.modify_code ?? 0) !== 0, fromDb: false });
  const excelMembers = eligible.map(toMember);
  const excelNts = new Set(excelMembers.map((m) => m.nts));
  // 미증빙 매입과 금액이 딱 맞는 (+) 장은 그 매입의 연결(P_link) 후보지 재발행이 아니다.
  const hasExactLink = (m: GroupMember) => !!m.partnerId && purchases.some((p) => p.partner_id === m.partnerId && p.is_documented && !p.tax_doc_no && !covered.has(p.id) && Math.abs(p.total_krw - m.total) < 1 && daysBetween(p.ordered_on, m.write_date) <= 10);
  const dbCancels: GroupMember[] = hometaxRows
    .filter((h) => h.isModify && h.total < 0 && ["unmatched", "candidate"].includes(h.match_status) && !excelNts.has(h.nts) && !liveByNts.has(h.nts) && !deletedByNts.has(h.nts))
    .map((h) => ({ nts: h.nts, write_date: h.write_date, total: h.total, partnerId: findPartner(h.biz, h.name)?.id ?? null, isModify: true, fromDb: true }));
  const grouped = groupModifyInvoices(
    [...excelMembers.filter((m) => m.isModify && m.total < 0), ...dbCancels],
    excelMembers.filter((m) => m.total > 0 && !hasExactLink(m)),
    anchors,
  );
  const groupDecision = (base: Omit<BuyDecision, "case" | "status" | "note" | "partner">, partner: PartnerLite | null, hit: { group: BuyGroup; role: BuyGroupRole }): BuyDecision => {
    const g = hit.group;
    const o = ntsTail(g.origNts);
    const cancels = g.members.filter((m) => m.role === "cancel").map((m) => ntsTail(m.nts)).join("·");
    const reissues = g.members.filter((m) => m.role === "reissue").map((m) => ntsTail(m.nts)).join("·");
    const common = { ...base, partner, purchaseId: g.purchaseId, purchaseDocNo: g.purchaseDocNo, group: g, groupRole: hit.role };
    if (g.auto) {
      covered.add(g.purchaseId);
      const note =
        hit.role === "cancel"
          ? `취소·재발행 묶음 — 수정(−) · 당초 ${o} / 수정(−) ${cancels} / 재발행 ${reissues} → 매입 ${g.purchaseDocNo} 유지(순합계 ${won(g.net)} = 당초)`
          : `취소·재발행 묶음 — 재발행 · 당초 ${o} / 수정(−) ${cancels} / 재발행 ${reissues} → 매입 ${g.purchaseDocNo} 증빙 ${o}→${ntsTail(g.reissue?.nts ?? "")} 교체`;
      return { ...common, case: "P_group", status: "linked", note };
    }
    if (!g.reissue) {
      return { ...common, case: "D_modify", status: "candidate", note: `수정(−) 대기 — 당초 ${o}(매입 ${g.purchaseDocNo}, ${won(g.origTotal)}) 취소분 · 재발행 아직 없음 · 그룹 순합계 ${won(g.net)}` };
    }
    const who = hit.role === "cancel" ? "수정(−)" : base.isModify ? "수정(+)" : "재발행";
    return { ...common, case: "D_modify", status: "candidate", note: `${who} — 그룹(당초 ${o} · 매입 ${g.purchaseDocNo}) 순합계 ${won(g.net)} ≠ 당초 ${won(g.origTotal)} · 차액 ${signed(g.diff)} → 금액 변동·환입, 매입 금액 확인 뒤 사람이 처리` };
  };

  // 3) 행마다 결정
  for (const r of buyRows) {
    const ins = r.insert;
    const sup = ins.supplier;
    const done = pre.get(ins.nts_confirm_num);
    if (done) {
      decisions.push(done);
      continue;
    }
    const base = baseOf(r);
    const partner = findPartner(sup.biz_no, sup.name);
    const hit = grouped.byNts.get(ins.nts_confirm_num);
    if (hit) {
      decisions.push(groupDecision(base, partner, hit));
      continue;
    }
    if (base.isModify) {
      const why = ins.total_amount < 0 ? ` · 당초 매입을 못 찾음(같은 공급자·${won(Math.abs(ins.total_amount))}·±10일 안 증빙 매입 없음)` : " · 순합계 확인 필요";
      decisions.push({ ...base, case: "D_modify", status: "candidate", note: `수정세금계산서${ins.orig_nts_confirm_num ? ` — 당초 ${ins.orig_nts_confirm_num}` : ""}${why}`, partner });
      continue;
    }
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
  // 4) 엑셀엔 없고 DB 에만 있던 (−) 후보가 이번 재발행과 묶였으면 그 결정도 낸다(상태·비고 갱신). 재발행이 없으면 그대로 둔다.
  for (const [nts, hit] of grouped.byNts) {
    if (!hit.member.fromDb || !hit.group.reissue) continue;
    const h = hometaxByNts.get(nts);
    const partner = h ? findPartner(h.biz, h.name) : null;
    decisions.push({
      ...groupDecision({ nts, rowNo: 0, write_date: hit.member.write_date, supplierName: h?.name ?? partner?.name ?? null, supplierBiz: h?.biz ?? "", total: hit.member.total, itemSummary: null, isModify: true }, partner, hit),
      fromDb: true,
    });
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
  // 결정에만 있는 승인번호(DB 에만 있던 (−) 후보)·묶음의 당초 장도 이전 상태를 읽어 둔다.
  const ntsList = [...new Set([...rows.map((r) => r.insert.nts_confirm_num), ...report.decisions.flatMap((d) => [d.nts, ...(d.group ? [d.group.origNts] : [])])])];
  const { data: existing } = await sb.from("hometax_invoice").select("nts_confirm_num, match_status, sale_id, tax_invoice_id, notes").in("nts_confirm_num", ntsList);
  const existingMap = new Map((existing ?? []).map((e) => [String(e.nts_confirm_num), e]));
  const partnerCache = new Map<string, string>();
  const groupsDone = new Set<string>(); // purchaseId — 묶음당 매입 갱신·메모는 한 번

  for (const d of report.decisions) {
    if (d.case === "S_skip") continue;
    const row = byNts.get(d.nts);
    if (!row && !(d.case === "P_group" && d.fromDb)) continue;
    const ins = row?.insert ?? null;
    const prev = existingMap.get(d.nts);
    const prevState = prev
      ? { match_status: String(prev.match_status), sale_id: (prev.sale_id as string | null) ?? null, tax_invoice_id: (prev.tax_invoice_id as string | null) ?? null, notes: (prev.notes as string | null) ?? null }
      : { match_status: "unmatched", sale_id: null, tax_invoice_id: null, notes: null };
    let purchaseId: string | null = null;
    let receiptId: string | null = null;
    let notes = d.note;

    if (d.case === "P_group" && d.group) {
      // 취소·재발행 묶음(순합계 = 당초): 세 장 모두 그 매입에 연결, 증빙 번호·수취일은 재발행 장으로. 매입 금액·라인은 그대로.
      const g = d.group;
      if (!groupsDone.has(g.purchaseId)) {
        groupsDone.add(g.purchaseId);
        const { data: before, error: bErr } = await sb.from("purchase").select("tax_doc_no, tax_invoice_received_on, deleted_at").eq("id", g.purchaseId).maybeSingle();
        if (bErr || !before || before.deleted_at) throw new Error(`묶음 대상 매입 ${g.purchaseDocNo}을(를) 찾을 수 없음${bErr ? `: ${bErr.message}` : ""}`);
        const prevDoc = { tax_doc_no: (before.tax_doc_no as string | null) ?? null, tax_invoice_received_on: (before.tax_invoice_received_on as string | null) ?? null };
        if (g.reissue) {
          const { error } = await sb.from("purchase").update({ tax_doc_no: g.reissue.nts, tax_invoice_received_on: g.reissue.write_date }).eq("id", g.purchaseId);
          if (error) throw new Error(`매입 증빙 교체 실패(${g.purchaseDocNo}): ${error.message}`);
          actions.push({ type: "purchase_linked", purchase_id: g.purchaseId, prev: prevDoc });
        }
        const line = (m: BuyGroup["members"][number]) => `${m.role === "cancel" ? "수정(−)" : "재발행"} ${m.nts}(${m.write_date}, ${signed(m.total)})`;
        const members = [...g.members].sort((a, b) => a.write_date.localeCompare(b.write_date) || (a.role === "cancel" ? -1 : 1));
        const { data: memo } = await sb
          .from("purchase_memo")
          .insert({
            purchase_id: g.purchaseId,
            body: `[홈택스 대조] 취소·재발행 묶음 — 당초 ${g.origNts}(${g.origDate}, ${won(g.origTotal)}) → ${members.map(line).join(" → ")} · 순합계 ${won(g.net)}원 = 당초 그대로(매입 금액 변경 없음). 증빙 번호 ${prevDoc.tax_doc_no ?? "-"}→${g.reissue?.nts ?? "-"}, 수취일 ${prevDoc.tax_invoice_received_on ?? "-"}→${g.reissue?.write_date ?? "-"}. 수집본 ${g.members.length + 1}장 모두 이 매입에 연결.`,
          })
          .select("id")
          .single();
        if (memo) actions.push({ type: "purchase_memo_created", memo_id: String(memo.id), purchase_id: g.purchaseId });
        // 당초 장 비고에 '취소·재발행됨' 표시(연결은 그대로) — 되돌리기는 비고만 복원.
        const orig = existingMap.get(g.origNts);
        if (orig) {
          const prevNotes = (orig.notes as string | null) ?? null;
          const tag = `당초(취소·재발행됨) — ${members.map((m) => `${m.role === "cancel" ? "수정(−)" : "재발행"} ${ntsTail(m.nts)}`).join(" / ")} · 증빙은 재발행 장으로 교체`;
          const { error: nErr } = await sb.from("hometax_invoice").update({ notes: prevNotes ? `${tag} | ${prevNotes}` : tag }).eq("nts_confirm_num", g.origNts);
          if (!nErr) actions.push({ type: "invoice_notes", nts: g.origNts, prev_notes: prevNotes });
        }
        log(`묶음: ${g.purchaseDocNo} 증빙 ${ntsTail(g.origNts)}→${ntsTail(g.reissue?.nts ?? "")} · ${g.members.length}장 연결 (${d.supplierName ?? ""} ${won(g.origTotal)})`);
      }
      purchaseId = g.purchaseId;
    } else if (!ins) {
      continue;
    } else if ((d.case === "P_nts" || d.case === "D_deleted") && d.purchaseId) {
      // 승인번호 보유 매입에 연결만 / 지운 매입 표시(정리 필요) — 매입은 고치지 않는다.
      purchaseId = d.purchaseId;
    } else if (d.case === "P_link" && d.purchaseId) {
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
