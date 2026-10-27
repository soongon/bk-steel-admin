import assert from "node:assert/strict";
import test from "node:test";
import {
  isReceiptUnpaid,
  isValidMonth,
  monthRange,
  shiftMonth,
  summarizeReceipts,
  type ReceiptListRow,
} from "../lib/receipt";

function row(over: Partial<ReceiptListRow>): ReceiptListRow {
  return {
    id: "r",
    book: "sl",
    receipt_on: "2026-10-05",
    category: "기타",
    amount_krw: 1000,
    vat_included: true,
    tax_doc_type: "tax_invoice_electronic",
    tax_doc_no: null,
    pay_method: null,
    pay_bank_account_id: null,
    notes: null,
    origin: null,
    origin_ref: null,
    partner: null,
    pay_bank_account: null,
    ...over,
  };
}

test("월 범위·이동·검증", () => {
  assert.deepEqual(monthRange("2026-10"), { start: "2026-10-01", end: "2026-11-01" });
  assert.deepEqual(monthRange("2026-12"), { start: "2026-12-01", end: "2027-01-01" });
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-10", -13), "2025-09");
  assert.ok(isValidMonth("2026-10"));
  assert.ok(!isValidMonth("2026-13"));
  assert.ok(!isValidMonth("2026-1"));
  assert.ok(!isValidMonth(undefined));
});

test("미지급 판정 — 결제수단·결제 통장이 모두 비면 미지급", () => {
  assert.ok(isReceiptUnpaid(row({})));
  assert.ok(!isReceiptUnpaid(row({ pay_method: "card" })));
  assert.ok(!isReceiptUnpaid(row({ pay_bank_account_id: "acct" })));
});

test("합계 줄 — 금액 합·미지급 합·홈택스 건수", () => {
  const s = summarizeReceipts([
    row({ amount_krw: 1_000, origin: "hometax" }),
    row({ amount_krw: 2_000, origin: "hometax", pay_method: "card" }),
    row({ amount_krw: 300 }),
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.total, 3_300);
  assert.equal(s.unpaid, 1_300);
  assert.equal(s.unpaidCount, 2);
  assert.equal(s.hometax, 2);
});
