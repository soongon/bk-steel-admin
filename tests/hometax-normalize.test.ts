import assert from "node:assert/strict";
import test from "node:test";
import { friendlyHometaxError, kindOf, normalizeInvoice, normalizeNts, recentRange, toIsoDate, toPopbillDate } from "../lib/hometax/normalize";

const abbr = {
  ntsconfirmNum: "202605123456789012345678",
  writeDate: "20260512",
  issueDate: "20260512",
  sendDate: "20260513",
  taxType: "과세",
  purposeType: "청구",
  issueType: "정발행",
  supplyCostTotal: "3000000",
  taxTotal: "300000",
  totalAmount: "3300000",
  itemName: "중고철근",
  modifyYN: "N",
  invoicerCorpNum: "123-45-67890",
  invoicerCorpName: "○○철거",
  invoicerCEOName: "김소장",
  invoiceeCorpNum: "5142154714",
  invoiceeCorpName: "신라철강",
  invoiceeType: "사업자",
};

test("날짜 변환", () => {
  assert.equal(toIsoDate("20260512"), "2026-05-12");
  assert.equal(toIsoDate("2026-05-12"), "2026-05-12");
  assert.equal(toIsoDate("20260512093000"), "2026-05-12");
  assert.equal(toIsoDate(""), null);
  assert.equal(toPopbillDate("2026-05-12"), "20260512");
});

test("요약만으로 정규화 — 매입, 사업자번호 숫자만, 금액 숫자", () => {
  const r = normalizeInvoice("sl", "buy", abbr, null, "2026-10-26T00:00:00Z");
  assert.ok(r);
  assert.equal(r.nts_confirm_num, "202605123456789012345678");
  assert.equal(r.kind, "tax_invoice");
  assert.equal(r.write_date, "2026-05-12");
  assert.equal(r.send_date, "2026-05-13");
  assert.equal(r.supplier.biz_no, "1234567890");
  assert.equal(r.invoicee.name, "신라철강");
  assert.equal(r.supply_amount, 3000000);
  assert.equal(r.total_amount, 3300000);
  assert.equal(r.item_summary, "중고철근");
  assert.equal(r.items, null);
  assert.equal(r.detail_fetched_at, null);
  assert.equal(r.modify_code, null);
  assert.deepEqual(Object.keys(r.raw), ["abbr"]);
});

test("상세가 있으면 품목 라인·수정사유·당초번호", () => {
  const detail = {
    modifyCode: 2,
    orgNTSConfirmNum: "202604000000000000000001",
    detailList: [
      { serialNum: "1", purchaseDT: "20260512", itemName: "중고철근 D22", spec: "9m", qty: "34", unitCost: "50000", supplyCost: "1700000", tax: "170000", remark: "" },
      { serialNum: "2", purchaseDT: "20260512", itemName: "고철", spec: "", qty: "", unitCost: "", supplyCost: "1300000", tax: "130000" },
    ],
  };
  const r = normalizeInvoice("sl", "buy", abbr, detail, "2026-10-26T00:00:00Z");
  assert.ok(r);
  assert.equal(r.modify_code, 2);
  assert.equal(r.orig_nts_confirm_num, "202604000000000000000001");
  assert.equal(r.items?.length, 2);
  assert.equal(r.items?.[0].qty, 34);
  assert.equal(r.items?.[1].qty, null);
  assert.equal(r.detail_fetched_at, "2026-10-26T00:00:00Z");
  assert.ok("detail" in r.raw);
});

test("수정분인데 상세 전이면 modify_code -1", () => {
  const r = normalizeInvoice("sl", "sell", { ...abbr, modifyYN: "Y" }, null);
  assert.equal(r?.modify_code, -1);
});

test("면세는 계산서 — 문자열·숫자 코드(웹훅) 모두", () => {
  assert.equal(kindOf("면세", null), "invoice");
  assert.equal(kindOf("과세", "전자세금계산서"), "tax_invoice");
  assert.equal(kindOf(null, "전자계산서"), "invoice");
  assert.equal(kindOf("과세", 101), "tax_invoice");
  assert.equal(kindOf("과세", 201), "tax_invoice");
  assert.equal(kindOf(null, 303), "invoice");
  assert.equal(kindOf(null, "404"), "invoice");
});

test("웹훅 바디 형식(issueDT 14자리·invoiceType 숫자) 정규화", () => {
  const r = normalizeInvoice("sl", "buy", { ...abbr, issueDate: undefined, issueDT: "20260512143000", invoiceType: 101 }, null);
  assert.equal(r?.issue_date, "2026-05-12");
  assert.equal(r?.kind, "tax_invoice");
});

test("승인번호: 하이픈 제거·16진수 문자 유지·소문자(실데이터 형식)", () => {
  assert.equal(normalizeNts("20261023-41000203-000048FB"), "2026102341000203000048fb");
  const r = normalizeInvoice("sl", "sell", { ...abbr, ntsconfirmNum: "20261023-41000203-000048fb", orgNTSConfirmNum: "20261001-41000203-0000AB12" }, null);
  assert.equal(r?.nts_confirm_num, "2026102341000203000048fb");
  assert.equal(r?.orig_nts_confirm_num, "20261001410002030000ab12");
});

test("승인번호·작성일 없으면 null", () => {
  assert.equal(normalizeInvoice("sl", "buy", { ...abbr, ntsconfirmNum: "123" }, null), null);
  assert.equal(normalizeInvoice("sl", "buy", { ...abbr, writeDate: "" }, null), null);
});

test("최근 7일 범위(KST)", () => {
  assert.deepEqual(recentRange(7, "2026-10-26"), { from: "2026-10-20", to: "2026-10-26" });
  assert.deepEqual(recentRange(1, "2026-10-26"), { from: "2026-10-26", to: "2026-10-26" });
});

test("권한 오류 문구", () => {
  assert.match(friendlyHometaxError("호출한 API 상품에 이용 권한이 부여되지 않아 사용이 제한됩니다."), /API 상품/);
  assert.equal(friendlyHometaxError("기타"), "기타");
});
