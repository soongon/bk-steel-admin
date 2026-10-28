/**
 * planBuy — 지운 매입의 공급자 계산서를 되살리지 않기(0095 매입 삭제).
 *   승인번호를 가진 살아 있는 매입(옮겨 받은 계산서) → P_nts, 지운 매입의 승인번호 → D_deleted,
 *   승인번호 없는 지운 자료 매입(수취 표시만·미연결) → 같은 거래처·합계·±31일 1:1 이면 D_deleted(매입 생성 안 함).
 * Supabase 는 표 몇 개를 든 가짜 클라이언트로 대신한다(eq/is/not/gte/lte/in/or 만 흉내).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExcelInvoiceRow } from "../lib/hometax/excel";
import { planBuy } from "../lib/hometax/reconcile-buy";
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

const STEEL = { id: "pt-steel", name: "가나철강", business_no: "1234567890", supply_kind: "inventory" };
const NTS_A = "20261005410000000000000a";
const NTS_B = "20261012410000000000000b";
const NTS_OLD = "20261001410000000000000c";

const TRUCK = { id: "pt-truck", name: "다라운송", business_no: "2223334445", supply_kind: "expense" };

function excelRow(o: { nts: string; date: string; total: number; rowNo?: number; supplier?: { business_no: string; name: string }; supply?: number }): ExcelInvoiceRow {
  const supply = o.supply ?? Math.round(o.total / 1.1);
  const who = o.supplier ?? STEEL;
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
      modify_code: null,
      orig_nts_confirm_num: null,
      write_date: o.date,
      issue_date: o.date,
      send_date: null,
      supplier: { biz_no: who.business_no, name: who.name, ceo: null, email: null, addr: null, tax_reg_id: null },
      invoicee: { biz_no: "5142154714", name: "신라철강", ceo: null, email: null, addr: null, tax_reg_id: null },
      trustee: null,
      supply_amount: supply,
      tax_amount: o.total - supply,
      total_amount: o.total,
      item_summary: "철근",
      items: null,
      detail_fetched_at: null,
      raw: { abbr: {} },
      source: "excel",
    },
  };
}

/** 매입 한 줄 — 기본은 사업자 책·자료·미증빙·살아 있음. */
function purchase(o: Partial<Row> & { id: string; doc_no: string; ordered_on: string; total_krw: number }): Row {
  return {
    book: "sl",
    is_documented: true,
    tax_doc_no: null,
    origin_ref: null,
    status: "in_stock",
    paid_on: null,
    partner_id: STEEL.id,
    deleted_at: null,
    delivered_on: null,
    tax_invoice_received_on: null,
    ...o,
  };
}
const tables = (purchases: Row[], hometax: Row[] = []) => ({ purchase: purchases, partner: [STEEL, TRUCK], hometax_invoice: hometax });
const none = new Map<string, HometaxMatchStatus>();

test("승인번호가 지운 매입에 있으면 D_deleted(그 매입 표시) · 살아 있는 매입에 있으면 P_nts 연결", async () => {
  const r = await planBuy(
    fakeClient(
      tables([
        purchase({ id: "pu-del", doc_no: "20261005-001", ordered_on: "2026-10-05", total_krw: 1100000, tax_doc_no: NTS_A, deleted_at: "2026-10-20T00:00:00Z" }),
        purchase({ id: "pu-live", doc_no: "20261012-001", ordered_on: "2026-10-12", total_krw: 2200000, tax_doc_no: NTS_B }),
      ]),
    ),
    "sl",
    [excelRow({ nts: NTS_A, date: "2026-10-05", total: 1100000 }), excelRow({ nts: NTS_B, date: "2026-10-12", total: 2200000, rowNo: 4 })],
    none,
  );
  const a = r.decisions.find((d) => d.nts === NTS_A)!;
  const b = r.decisions.find((d) => d.nts === NTS_B)!;
  assert.equal(a.case, "D_deleted");
  assert.equal(a.status, "candidate");
  assert.equal(a.purchaseId, "pu-del");
  assert.equal(b.case, "P_nts");
  assert.equal(b.status, "linked");
  assert.equal(b.purchaseId, "pu-live");
});

test("승인번호 없는 지운 자료 매입(수취 표시만) — 같은 거래처·합계·±31일 1:1 이면 D_deleted, 매입을 다시 만들지 않는다", async () => {
  const r = await planBuy(
    fakeClient(
      tables([
        purchase({ id: "pu-del", doc_no: "20261005-001", ordered_on: "2026-10-05", total_krw: 1100000, tax_invoice_received_on: "2026-10-06", deleted_at: "2026-10-20T00:00:00Z" }),
      ]),
    ),
    "sl",
    [excelRow({ nts: NTS_A, date: "2026-10-30", total: 1100000 })],
    none,
  );
  assert.deepEqual(r.summary, { D_deleted: 1 });
  assert.equal(r.decisions[0].purchaseId, "pu-del");
  assert.match(r.decisions[0].note, /지운 매입 20261005-001\(승인번호 없음\)/);
});

test("한 지운 매입에 이번 파일 두 장이 걸리면 어느 것인지 모르니 둘 다 매입 연결 없이 D_deleted 후보", async () => {
  const r = await planBuy(
    fakeClient(tables([purchase({ id: "pu-del", doc_no: "20261005-001", ordered_on: "2026-10-05", total_krw: 1100000, deleted_at: "2026-10-20T00:00:00Z" })])),
    "sl",
    [excelRow({ nts: NTS_A, date: "2026-10-05", total: 1100000 }), excelRow({ nts: NTS_B, date: "2026-10-08", total: 1100000, rowNo: 4 })],
    none,
  );
  assert.deepEqual(r.summary, { D_deleted: 2 });
  for (const d of r.decisions) assert.equal(d.purchaseId, undefined);
});

test("살아 있는 같은 금액 매입이 있으면 그 매입에 연결(P_link)이 먼저 — 대체 매입으로 다시 만든 경우", async () => {
  const r = await planBuy(
    fakeClient(
      tables([
        purchase({ id: "pu-del", doc_no: "20261005-001", ordered_on: "2026-10-05", total_krw: 1100000, deleted_at: "2026-10-20T00:00:00Z" }),
        purchase({ id: "pu-new", doc_no: "20261006-001", ordered_on: "2026-10-06", total_krw: 1100000 }),
      ]),
    ),
    "sl",
    [excelRow({ nts: NTS_A, date: "2026-10-05", total: 1100000 })],
    none,
  );
  assert.equal(r.decisions[0].case, "P_link");
  assert.equal(r.decisions[0].purchaseId, "pu-new");
});

test("대상에서 빠지는 지운 매입 — 다른 계산서가 이미 가리킴·무자료·±31일 밖 → 평소대로 매입 생성", async () => {
  const r = await planBuy(
    fakeClient(
      tables(
        [
          purchase({ id: "pu-taken", doc_no: "20261005-001", ordered_on: "2026-10-05", total_krw: 1100000, deleted_at: "2026-10-20T00:00:00Z" }),
          purchase({ id: "pu-nodoc", doc_no: "20261005-002", ordered_on: "2026-10-05", total_krw: 1100000, is_documented: false, deleted_at: "2026-10-20T00:00:00Z" }),
          purchase({ id: "pu-far", doc_no: "20260801-001", ordered_on: "2026-08-01", total_krw: 1100000, deleted_at: "2026-10-20T00:00:00Z" }),
        ],
        [{ nts_confirm_num: NTS_OLD, book: "sl", direction: "buy", write_date: "2026-10-01", total_amount: 1100000, modify_code: null, match_status: "ignored", purchase_id: "pu-taken", supplier: { biz_no: STEEL.business_no, name: STEEL.name } }],
      ),
    ),
    "sl",
    [excelRow({ nts: NTS_A, date: "2026-10-05", total: 1100000 })],
    none,
  );
  assert.deepEqual(r.summary, { P_create: 1 });
});

test("수취 표시를 옮겨 받은 살아 있는 매입이 있으면(±10일 밖이어도) 지운 매입에 붙이지 않고 평소 중복 후보로", async () => {
  const r = await planBuy(
    fakeClient(
      tables([
        purchase({ id: "pu-del", doc_no: "20261001-001", ordered_on: "2026-10-01", total_krw: 1100000, tax_invoice_received_on: "2026-10-05", deleted_at: "2026-10-28T00:00:00Z" }),
        purchase({ id: "pu-new", doc_no: "20261028-001", ordered_on: "2026-10-28", total_krw: 1100000, tax_invoice_received_on: "2026-10-05" }),
      ]),
    ),
    "sl",
    [excelRow({ nts: NTS_A, date: "2026-10-05", total: 1100000 })],
    none,
  );
  assert.equal(r.decisions[0].case, "D_dup");
  assert.equal(r.decisions[0].candidates?.[0].doc_no, "20261028-001");
});

test("비용 업체의 계산서는 지운 매입과 금액이 같아도 영수증 생성(R_create) 그대로", async () => {
  const r = await planBuy(
    fakeClient(tables([purchase({ id: "pu-del", doc_no: "20261005-001", ordered_on: "2026-10-05", total_krw: 330000, partner_id: TRUCK.id, deleted_at: "2026-10-20T00:00:00Z" })])),
    "sl",
    [excelRow({ nts: NTS_A, date: "2026-10-06", total: 330000, supplier: TRUCK })],
    none,
  );
  assert.deepEqual(r.summary, { R_create: 1 });
});

test("공급자 세액 끝전(10원 이내) 차이는 같은 금액으로 본다", async () => {
  const r = await planBuy(
    fakeClient(tables([purchase({ id: "pu-del", doc_no: "20261005-001", ordered_on: "2026-10-05", total_krw: 1100006, tax_invoice_received_on: "2026-10-05", deleted_at: "2026-10-20T00:00:00Z" })])),
    "sl",
    [excelRow({ nts: NTS_A, date: "2026-10-05", total: 1100005, supply: 1000005 })],
    none,
  );
  assert.equal(r.decisions[0].case, "D_deleted");
  assert.equal(r.decisions[0].purchaseId, "pu-del");
});

test("같은 파일의 다른 행이 살아 있는 매입에 연결(P_link)되면 남은 행은 지운 매입과 1:1 — '여럿'으로 잘못 보지 않는다", async () => {
  const r = await planBuy(
    fakeClient(
      tables([
        purchase({ id: "pu-del", doc_no: "20261005-001", ordered_on: "2026-10-05", total_krw: 1100000, deleted_at: "2026-10-20T00:00:00Z" }),
        purchase({ id: "pu-live", doc_no: "20261006-001", ordered_on: "2026-10-06", total_krw: 1100000 }),
      ]),
    ),
    "sl",
    [excelRow({ nts: NTS_A, date: "2026-10-06", total: 1100000 }), excelRow({ nts: NTS_B, date: "2026-10-25", total: 1100000, rowNo: 4 })],
    none,
  );
  const a = r.decisions.find((d) => d.nts === NTS_A)!;
  const b = r.decisions.find((d) => d.nts === NTS_B)!;
  assert.equal(a.case, "P_link");
  assert.equal(a.purchaseId, "pu-live");
  assert.equal(b.case, "D_deleted");
  assert.equal(b.purchaseId, "pu-del");
});
