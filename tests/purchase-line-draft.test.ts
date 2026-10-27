import assert from "node:assert/strict";
import test from "node:test";
import {
  calcPurchaseLine,
  isHometaxPlaceholderLine,
  purchaseLineToDraft,
  serializePurchaseLines,
  withAdjustmentLine,
} from "../lib/purchase-line-draft";
import { STEEL_CUSTOM_ITEM_ID } from "../lib/transaction-draft";

const D13 = { id: "i-d13", name: "D13 8M", rebar_spec_code: "D13", rebar_grade_code: "SD400", length_m: 8, bars_per_tonne: 126 };
const STEEL = { id: STEEL_CUSTOM_ITEM_ID, name: "철제 직접입력", rebar_spec_code: null, rebar_grade_code: null, length_m: null, bars_per_tonne: null };
const ITEMS = [D13, STEEL];
const SPECS = [{ spec_code: "D13", unit_weight_kg_per_m: 0.995, standard_length_m: 8 }];

test("kg 라인은 실중량 × 원/kg, 철제는 단가 × 수량", () => {
  const kg = calcPurchaseLine(ITEMS, SPECS, { itemKind: "rebar", itemId: D13.id, unit: "kg", qty: 1234, unitPrice: 700, actualWeight: 1234 });
  assert.equal(kg.subtotal, 863_800);
  const steel = calcPurchaseLine(ITEMS, SPECS, { itemKind: "steel", itemId: STEEL.id, unit: "ea", qty: 1, unitPrice: 2_000_000, actualWeight: null });
  assert.equal(steel.subtotal, 2_000_000);
  assert.equal(steel.calc, null);
});

test("저장 라인 → 초안: piece 는 ea, kg 는 수량=실중량, 조정 라인 판정", () => {
  const kg = purchaseLineToDraft({ item: { id: D13.id, rebar_spec_code: "D13" }, acquired_unit: "kg", acquired_qty: "500.000", unit_price_krw: "700.00", actual_weight_kg: "500.000" });
  assert.deepEqual([kg.itemKind, kg.unit, kg.qty, kg.unitPrice, kg.actualWeight], ["rebar", "kg", 500, 700, 500]);
  const piece = purchaseLineToDraft({ item: { id: D13.id, rebar_spec_code: "D13" }, acquired_unit: "piece", acquired_qty: 10, unit_price_krw: 700, actual_weight_kg: null });
  assert.equal(piece.unit, "ea");
  assert.equal(piece.actualWeight, null);
  const adj = purchaseLineToDraft({ item: { id: STEEL.id, rebar_spec_code: null }, acquired_unit: "ea", acquired_qty: 1, unit_price_krw: -1200, actual_weight_kg: null, notes: "계산서 금액 맞춤: 품목 합 …" });
  assert.equal(adj.adjustment, true);
  assert.equal(adj.itemKind, "steel");
});

test("홈택스 금액 라인(품목 미정) 판정은 비고 머리말까지 본다", () => {
  assert.equal(isHometaxPlaceholderLine({ itemId: STEEL.id, unit: "ea", qty: 1, notes: "홈택스 계산서분 — 철근 매각" }), true);
  assert.equal(isHometaxPlaceholderLine({ itemId: STEEL.id, unit: "ea", qty: 1, notes: null }), false);
  assert.equal(isHometaxPlaceholderLine({ itemId: D13.id, unit: "kg", qty: 1, notes: "홈택스 계산서분" }), false);
});

test("계산서 금액 맞춤 — 차액을 조정 라인 1줄로, 재호출해도 1줄", () => {
  const base = [{ itemKind: "rebar" as const, itemId: D13.id, unit: "kg" as const, qty: 1000, unitPrice: 700, actualWeight: 1000 }];
  const r1 = withAdjustmentLine(ITEMS, SPECS, base, 712_000, "abc123xyz", (n) => String(n));
  assert.equal(r1.diff, 12_000);
  assert.equal(r1.lines.length, 2);
  assert.equal(r1.lines[1].unitPrice, 12_000);
  assert.equal(r1.lines[1].adjustment, true);
  assert.match(r1.lines[1].notes ?? "", /승인 …123xyz/);
  const r2 = withAdjustmentLine(ITEMS, SPECS, r1.lines, 690_000, null, (n) => String(n));
  assert.equal(r2.lines.length, 2);
  assert.equal(r2.lines[1].unitPrice, -10_000);
  const r3 = withAdjustmentLine(ITEMS, SPECS, r1.lines, 700_000, null, (n) => String(n));
  assert.equal(r3.lines.length, 1);
});

test("직렬화 — 서버 파서가 받는 키와 allow_negative", () => {
  const json = JSON.parse(
    serializePurchaseLines(ITEMS, SPECS, [
      { itemKind: "rebar", itemId: D13.id, unit: "kg", qty: 500, unitPrice: 700, actualWeight: 500 },
      { itemKind: "steel", itemId: STEEL.id, unit: "ea", qty: 1, unitPrice: -3000, actualWeight: null, notes: "계산서 금액 맞춤", adjustment: true },
    ]),
  );
  assert.equal(json[0].unit, "kg");
  assert.equal(json[0].actual_weight_kg, 500);
  assert.ok(json[0].bars_count > 0);
  assert.equal(json[1].allow_negative, true);
  assert.equal(json[1].bars_count, null);
});
