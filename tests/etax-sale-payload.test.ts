/**
 * 매출 → 전자세금계산서 payload — 공급받는자 업태·종목(0096). 발행 창에 적은 값이 우선(빈 칸 포함),
 * 안 넘기면 거래처의 업태·종목. 모두 지어낸 회사·번호.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildSaleEtaxInput } from "../lib/etax/sale-payload";
import type { CompanyProfile } from "../lib/company-profile";

const company = {
  book: "sl",
  name: "우리철강",
  business_no: "1234567891",
  representative: "홍길동",
  address: "경주시 1",
  business_type: "도매 및 소매업",
  business_item: "철강재",
  phone: "0541112222",
  mobile: null,
  email: "own@example.com",
} as unknown as CompanyProfile;

const sale = {
  book: "sl",
  doc_no: "20261028-001",
  ordered_on: "2026-10-28",
  is_documented: true,
  vat_type: "taxable",
  vat_rate: 10,
  subtotal_krw: 100000,
  vat_krw: 10000,
  total_krw: 110000,
  partner: {
    id: "p1",
    name: "가나건설",
    business_no: "1112223339",
    representative: "김대표",
    address: "포항시 1",
    business_type: "건설업",
    business_item: "철근콘크리트공사",
    email: "a@example.com",
    email2: null,
    phone: "0540000000",
  },
  sale_line: [{ qty: 1, unit: "ea", unit_price_krw: 100000, line_subtotal_krw: 100000, display_name: "철판", spec_text: null, item: { name: "철판", category: "steel" } }],
};

const base = { writeDateIso: "2026-10-28", purpose: "charge" as const, remark: null, buyerBizNo: "1112223339", buyerEmail: null, buyerEmail2: null, buyerCeo: "김대표" };

test("업태·종목을 안 넘기면 거래처의 업태·종목", () => {
  const input = buildSaleEtaxInput(sale, company, base);
  assert.equal(input.buyer.bizType, "건설업");
  assert.equal(input.buyer.bizClass, "철근콘크리트공사");
  assert.equal(input.supplier.bizType, "도매 및 소매업");
  assert.equal(input.supplier.bizClass, "철강재");
});

test("발행 창에 적은 업태·종목이 우선 — null 은 빈 칸으로 발행", () => {
  const input = buildSaleEtaxInput(sale, company, { ...base, buyerBizType: "건설업, 부동산업", buyerBizClass: null });
  assert.equal(input.buyer.bizType, "건설업, 부동산업");
  assert.equal(input.buyer.bizClass, null);
});

test("거래처에 업태·종목이 없으면 빈 칸", () => {
  const input = buildSaleEtaxInput({ ...sale, partner: { ...sale.partner, business_type: null, business_item: null } }, company, base);
  assert.equal(input.buyer.bizType, null);
  assert.equal(input.buyer.bizClass, null);
});
