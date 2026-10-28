/**
 * rollbackActions — 매입 삭제(0095) 이후에도 홈택스 대조 작업 되돌리기가 남겨야 할 것을 지우지 않는지.
 *   · 그 뒤 매입 삭제가 옮기거나(이관)·무시·정리한 수집본, 남기는 생성 매입(지웠거나 결제가 붙음)을 가리키는 수집본
 *   · 그 뒤 다른 작업이 연결을 바꾼 수집본(예: 분류 버튼으로 영수증 생성)
 * Supabase 는 select/update/delete + eq 만 흉내 내는 메모리 클라이언트로 대신한다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rollbackActions, type Action } from "../lib/hometax/reconcile";

type Row = Record<string, unknown>;
function memoryClient(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let mode: "select" | "update" | "delete" = "select";
    let patch: Row = {};
    let head = false;
    const rows = () => (tables[table] ??= []).filter((r) => filters.every(([c, v]) => (r[c] ?? null) === v));
    const run = () => {
      if (mode === "update") {
        for (const r of rows()) Object.assign(r, patch);
        return { data: null, error: null };
      }
      if (mode === "delete") {
        const gone = new Set(rows());
        tables[table] = tables[table].filter((r) => !gone.has(r));
        return { data: null, error: null };
      }
      return head ? { data: null, count: rows().length, error: null } : { data: rows(), error: null };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: (_c?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), b),
      update: (p: Row) => ((mode = "update"), (patch = p), b),
      delete: () => ((mode = "delete"), b),
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const unmatched = { match_status: "unmatched", sale_id: null, tax_invoice_id: null, notes: null, purchase_id: null, receipt_id: null };
const invoice = (nts: string, o: Row = {}): Row => ({
  nts_confirm_num: nts,
  match_status: "linked",
  purchase_id: null,
  receipt_id: null,
  sale_id: null,
  tax_invoice_id: null,
  notes: null,
  ignore_reason: null,
  resolved_at: null,
  ...o,
});

test("보통 되돌리기 — 이 작업이 만든 매입·메모·수집본을 모두 지운다", async () => {
  const db: Record<string, Row[]> = {
    hometax_invoice: [invoice("N1", { purchase_id: "P1", notes: "재고 매입처 → 매입 생성" })],
    purchase: [{ id: "P1", origin: "hometax", deleted_at: null }],
    purchase_memo: [{ id: "M1" }],
    bank_transaction: [],
  };
  const actions: Action[] = [
    { type: "invoice_insert", nts: "N1" },
    { type: "purchase_created", purchase_id: "P1", doc_no: "20261005-001" },
    { type: "purchase_memo_created", memo_id: "M1", purchase_id: "P1" },
    { type: "invoice_status", nts: "N1", prev: unmatched, next: { purchase_id: "P1", receipt_id: null } },
  ];
  await rollbackActions(memoryClient(db), actions);
  assert.equal(db.hometax_invoice.length, 0);
  assert.equal(db.purchase.length, 0);
  assert.equal(db.purchase_memo.length, 0);
});

test("결제가 붙은 생성 매입은 남기고, 그 매입을 가리키는 수집본도 지우지 않는다", async () => {
  const db: Record<string, Row[]> = {
    hometax_invoice: [invoice("N1", { purchase_id: "P1" })],
    purchase: [{ id: "P1", origin: "hometax", deleted_at: null }],
    bank_transaction: [{ id: "B1", purchase_id: "P1" }],
  };
  await rollbackActions(memoryClient(db), [
    { type: "invoice_insert", nts: "N1" },
    { type: "purchase_created", purchase_id: "P1", doc_no: "20261005-001" },
    { type: "invoice_status", nts: "N1", prev: unmatched, next: { purchase_id: "P1", receipt_id: null } },
  ]);
  assert.equal(db.purchase.length, 1);
  assert.equal(db.hometax_invoice.length, 1);
  assert.equal(db.hometax_invoice[0].purchase_id, "P1");
});

test("매입 삭제로 다른 매입에 옮겨진(이관) 수집본 — 상태·비고를 되돌리지도 지우지도 않는다", async () => {
  const db: Record<string, Row[]> = {
    hometax_invoice: [invoice("O1", { purchase_id: "T1", notes: "당초 | 매입 D1 → T1 이관(2026-10-28)" })],
    purchase: [{ id: "D1", deleted_at: "2026-10-28T00:00:00Z", tax_doc_no: "O1" }],
  };
  await rollbackActions(memoryClient(db), [
    { type: "invoice_insert", nts: "O1" },
    { type: "purchase_linked", purchase_id: "D1", prev: { tax_doc_no: null, tax_invoice_received_on: null } },
    { type: "invoice_notes", nts: "O1", prev_notes: "당초" },
    { type: "invoice_status", nts: "O1", prev: unmatched, next: { purchase_id: "D1", receipt_id: null } },
  ]);
  assert.equal(db.hometax_invoice.length, 1);
  assert.equal(db.hometax_invoice[0].purchase_id, "T1");
  assert.match(String(db.hometax_invoice[0].notes), /이관\(/);
  assert.equal(db.purchase[0].tax_doc_no, "O1"); // 지운 매입은 건드리지 않음
});

test("그 뒤 다른 작업이 연결을 바꾼 수집본(분류 버튼 → 영수증) — 이 작업만 되돌려도 연결·수집본이 남는다", async () => {
  const db: Record<string, Row[]> = {
    hometax_invoice: [invoice("R1", { match_status: "linked", receipt_id: "RC1", notes: "비용(영수증) 생성 · 운송비" })],
  };
  await rollbackActions(memoryClient(db), [
    { type: "invoice_insert", nts: "R1" },
    { type: "invoice_status", nts: "R1", prev: unmatched, next: { purchase_id: null, receipt_id: null } },
  ]);
  assert.equal(db.hometax_invoice.length, 1);
  assert.equal(db.hometax_invoice[0].receipt_id, "RC1");
});

test("지운 매입을 가리키던 후보(D_deleted)를 다시 판정한 작업을 되돌리면 이전 연결(지운 매입)을 복원한다", async () => {
  const db: Record<string, Row[]> = {
    hometax_invoice: [invoice("X1", { match_status: "candidate", purchase_id: "D1", notes: "지운 매입 D1의 계산서 — 2차" })],
  };
  await rollbackActions(memoryClient(db), [
    {
      type: "invoice_status",
      nts: "X1",
      prev: { match_status: "candidate", sale_id: null, tax_invoice_id: null, notes: "지운 매입 D1의 계산서 — 1차", purchase_id: "D1", receipt_id: null },
      next: { purchase_id: "D1", receipt_id: null },
    },
  ]);
  assert.equal(db.hometax_invoice[0].purchase_id, "D1");
  assert.equal(db.hometax_invoice[0].notes, "지운 매입 D1의 계산서 — 1차");
});
