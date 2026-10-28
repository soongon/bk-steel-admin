/**
 * planBuy — 매입 수정세금계산서 취소·재발행 묶기(기획 §3.2·§15.2-7).
 * Supabase 는 표 몇 개를 든 가짜 클라이언트로 대신한다(eq/is/not/gte/lte/in/or 만 흉내).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExcelInvoiceRow } from "../lib/hometax/excel";
import { describeGroup, groupModifyInvoices, planBuy } from "../lib/hometax/reconcile-buy";
import type { HometaxMatchStatus } from "../lib/hometax/types";

type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const val = (r: Row, c: string) => (r[c] === undefined ? null : r[c]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => val(r, c) === v)), b),
      neq: (c: string, v: unknown) => ((rows = rows.filter((r) => val(r, c) !== v)), b),
      is: (c: string, v: unknown) => ((rows = rows.filter((r) => val(r, c) === v)), b),
      not: (c: string, op: string, v: unknown) => ((rows = op === "is" ? rows.filter((r) => val(r, c) !== v) : rows), b),
      gte: (c: string, v: string) => ((rows = rows.filter((r) => String(val(r, c)) >= v)), b),
      lte: (c: string, v: string) => ((rows = rows.filter((r) => String(val(r, c)) <= v)), b),
      in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(val(r, c)))), b),
      or: (expr: string) => {
        const conds = expr.split(",").map((x) => x.split("."));
        rows = rows.filter((r) => conds.some(([c, ...rest]) => (rest.join(".") === "not.is.null" ? val(r, c) !== null : true)));
        return b;
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { message: "no rows" } }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const POSCO = { id: "pt-posco", name: "포스코이앤씨", business_no: "1208100345", supply_kind: "inventory" };
const OTHER = { id: "pt-other", name: "코리아스틸샵", business_no: "2208111111", supply_kind: "inventory" };
const ORIG = "2026102341000203000029ab";
const CANCEL = "2026102841000203000058a8";
const REISSUE = "2026102841000203000016e7";

function excelRow(o: { nts: string; date: string; total: number; modify?: boolean; biz?: string; name?: string; rowNo?: number }): ExcelInvoiceRow {
  const supply = Math.round(o.total / 1.1);
  return {
    rowNo: o.rowNo ?? 3,
    collectType: "홈택스",
    popbillMatched: null,
    insert: {
      book: "sl",
      direction: "buy",
      nts_confirm_num: o.nts,
      kind: "tax_invoice",
      tax_type: "과세",
      issue_type: null,
      purpose: "청구",
      modify_code: o.modify ? -1 : null,
      orig_nts_confirm_num: null,
      write_date: o.date,
      issue_date: o.date,
      send_date: null,
      supplier: { biz_no: o.biz ?? POSCO.business_no, name: o.name ?? POSCO.name, ceo: null, email: null, addr: null, tax_reg_id: null },
      invoicee: { biz_no: "5142154714", name: "신라철강", ceo: null, email: null, addr: null, tax_reg_id: null },
      trustee: null,
      supply_amount: supply,
      tax_amount: o.total - supply,
      total_amount: o.total,
      item_summary: "철근 매각",
      items: null,
      detail_fetched_at: null,
      raw: { abbr: {} },
      source: "excel",
    },
  };
}

/** 당초 …29ab(10-23, 1,537,800)가 매입 20261023-001 에 linked 된 시스템 상태. */
function baseTables(extra: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    purchase: [
      { id: "pu-1", book: "sl", doc_no: "20261023-001", ordered_on: "2026-10-23", total_krw: 1537800, is_documented: true, tax_doc_no: ORIG, status: "in_stock", paid_on: null, partner_id: POSCO.id, deleted_at: null, origin_ref: ORIG, tax_invoice_received_on: "2026-10-23" },
      ...(extra.purchase ?? []),
    ],
    partner: [POSCO, OTHER, ...(extra.partner ?? [])],
    hometax_invoice: [
      { nts_confirm_num: ORIG, book: "sl", direction: "buy", write_date: "2026-10-23", total_amount: 1537800, modify_code: null, match_status: "linked", purchase_id: "pu-1", supplier: { biz_no: POSCO.business_no, name: POSCO.name } },
      ...(extra.hometax_invoice ?? []),
    ],
  };
}
const linkedOrig = new Map<string, HometaxMatchStatus>([[ORIG, "linked"]]);

test("취소·재발행(금액 동일) — 세 장을 한 그룹으로, (−)·재발행은 P_group linked, 증빙 교체 대상은 재발행 장", async () => {
  const rows = [
    excelRow({ nts: ORIG, date: "2026-10-23", total: 1537800, rowNo: 3 }),
    excelRow({ nts: CANCEL, date: "2026-10-23", total: -1537800, modify: true, rowNo: 4 }), // 작성 10-23·발행 10-28
    excelRow({ nts: REISSUE, date: "2026-10-28", total: 1537800, rowNo: 5 }), // 재발행은 '일반'
  ];
  const r = await planBuy(fakeClient(baseTables()), "sl", rows, linkedOrig);
  assert.deepEqual(r.summary, { S_skip: 1, P_group: 2 });
  const cancel = r.decisions.find((d) => d.nts === CANCEL)!;
  const reissue = r.decisions.find((d) => d.nts === REISSUE)!;
  assert.equal(cancel.case, "P_group");
  assert.equal(cancel.status, "linked");
  assert.equal(cancel.groupRole, "cancel");
  assert.equal(cancel.purchaseDocNo, "20261023-001");
  assert.equal(reissue.case, "P_group");
  assert.equal(reissue.groupRole, "reissue");
  assert.equal(reissue.purchaseId, "pu-1");
  const g = reissue.group!;
  assert.equal(g.auto, true);
  assert.equal(g.origNts, ORIG);
  assert.equal(g.origDate, "2026-10-23");
  assert.equal(g.net, 1537800);
  assert.equal(g.diff, 0);
  assert.deepEqual(g.reissue, { nts: REISSUE, write_date: "2026-10-28" });
  assert.equal(g.members.length, 2);
  assert.match(reissue.note, /증빙 …0029ab→…0016e7 교체/);
  assert.equal(describeGroup(reissue), "재발행 · 당초 …0029ab · 순합계 1,537,800");
});

test("금액 변동 — (−)당초 + (+)수정 1,200,000: 순합계 ≠ 당초 → 둘 다 D_modify 후보, 차액을 적는다", async () => {
  const rows = [
    excelRow({ nts: CANCEL, date: "2026-10-23", total: -1537800, modify: true }),
    excelRow({ nts: REISSUE, date: "2026-10-28", total: 1200000, modify: true }),
  ];
  const r = await planBuy(fakeClient(baseTables()), "sl", rows, linkedOrig);
  assert.deepEqual(r.summary, { D_modify: 2 });
  for (const d of r.decisions) {
    assert.equal(d.status, "candidate");
    assert.equal(d.group?.auto, false);
    assert.equal(d.group?.net, 1200000);
    assert.equal(d.group?.diff, -337800);
    assert.match(d.note, /순합계 1,200,000 ≠ 당초 1,537,800 · 차액 −337,800/);
  }
  assert.equal(describeGroup(r.decisions[0]), "수정(−) · 당초 …0029ab · 순합계 1,200,000 (차액 −337,800)");
});

test("(−)만 있음 — '수정(−) 대기' 후보. 같은 공급자의 다른 금액 일반 장은 끌어오지 않고 평소대로 매입 생성", async () => {
  const rows = [
    excelRow({ nts: CANCEL, date: "2026-10-28", total: -1537800, modify: true }),
    excelRow({ nts: "2026102841000203000077aa", date: "2026-10-28", total: 500000 }), // 정상 계산서(금액 다름·일반)
  ];
  const r = await planBuy(fakeClient(baseTables()), "sl", rows, linkedOrig);
  assert.deepEqual(r.summary, { D_modify: 1, P_create: 1 });
  const cancel = r.decisions.find((d) => d.nts === CANCEL)!;
  assert.equal(cancel.status, "candidate");
  assert.match(cancel.note, /수정\(−\) 대기 — 당초 …0029ab\(매입 20261023-001, 1,537,800\)/);
  assert.equal(cancel.group?.reissue, null);
  assert.equal(cancel.group?.net, 0);
  assert.equal(describeGroup(cancel), "수정(−) · 당초 …0029ab · 순합계 0 (차액 −1,537,800)");
});

test("당초 매입이 없는 (−) — 묶지 않고 D_modify, 다른 거래처 매입엔 붙지 않는다", async () => {
  const rows = [excelRow({ nts: CANCEL, date: "2026-10-28", total: -1537800, modify: true, biz: OTHER.business_no, name: OTHER.name })];
  const r = await planBuy(fakeClient(baseTables()), "sl", rows, new Map());
  assert.deepEqual(r.summary, { D_modify: 1 });
  assert.equal(r.decisions[0].group, undefined);
  assert.match(r.decisions[0].note, /당초 매입을 못 찾음/);
});

test("±10일 밖의 (−)는 묶지 않는다", async () => {
  const rows = [excelRow({ nts: CANCEL, date: "2026-11-05", total: -1537800, modify: true })];
  const r = await planBuy(fakeClient(baseTables()), "sl", rows, linkedOrig);
  assert.equal(r.decisions[0].case, "D_modify");
  assert.equal(r.decisions[0].group, undefined);
});

test("엑셀엔 없고 DB 에만 남은 (−) 후보 — 이번 재발행과 묶이면 그 (−)도 결정에 들어온다(fromDb)", async () => {
  const tables = baseTables({
    hometax_invoice: [{ nts_confirm_num: CANCEL, book: "sl", direction: "buy", write_date: "2026-10-23", total_amount: -1537800, modify_code: -1, match_status: "candidate", purchase_id: null, supplier: { biz_no: POSCO.business_no, name: POSCO.name } }],
  });
  const rows = [excelRow({ nts: REISSUE, date: "2026-10-28", total: 1537800 })];
  const r = await planBuy(fakeClient(tables), "sl", rows, new Map([[ORIG, "linked"], [CANCEL, "candidate"]]));
  assert.deepEqual(r.summary, { P_group: 2 });
  const fromDb = r.decisions.find((d) => d.nts === CANCEL)!;
  assert.equal(fromDb.fromDb, true);
  assert.equal(fromDb.rowNo, 0);
  assert.equal(fromDb.supplierName, POSCO.name);
  assert.equal(r.decisions.find((d) => d.nts === REISSUE)!.group?.auto, true);
});

test("이미 처리된 세 장(수기 묶음 뒤 재업로드)은 전부 S_skip — 쓰기 0건", async () => {
  const rows = [
    excelRow({ nts: ORIG, date: "2026-10-23", total: 1537800 }),
    excelRow({ nts: CANCEL, date: "2026-10-23", total: -1537800, modify: true }),
    excelRow({ nts: REISSUE, date: "2026-10-28", total: 1537800 }),
  ];
  const r = await planBuy(fakeClient(baseTables()), "sl", rows, new Map([[ORIG, "linked"], [CANCEL, "linked"], [REISSUE, "linked"]]));
  assert.deepEqual(r.summary, { S_skip: 3 });
});

test("groupModifyInvoices — 재발행 두 장(같은 금액)이면 순합계가 어긋나 자동 아님, 가장 늦은 장이 교체 대상", () => {
  const anchor = { purchaseId: "pu-1", docNo: "20261023-001", partnerId: "p", total: 100, origNts: "o", origDate: "2026-10-23" };
  const m = (nts: string, write_date: string, total: number, isModify = false) => ({ nts, write_date, total, partnerId: "p", isModify, fromDb: false });
  const r = groupModifyInvoices([m("c", "2026-10-24", -100, true)], [m("r1", "2026-10-25", 100), m("r2", "2026-10-26", 100), m("x", "2026-10-26", 30)], [anchor]);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].net, 200);
  assert.equal(r.groups[0].auto, false);
  assert.equal(r.groups[0].reissue?.nts, "r2");
  assert.equal(r.byNts.has("x"), false); // 다른 금액 일반 장은 안 끌어옴
});
