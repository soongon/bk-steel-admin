import assert from "node:assert/strict";
import test from "node:test";
import {
  BIZ_TYPE_ITEM_MAX,
  bizListText,
  bizNoConflicts,
  canAutoRegister,
  docKindOf,
  fillEmpty,
  isValidBizNo,
  partnerFieldsOf,
  pickCounterparty,
  sanitizeReading,
  type BizParty,
} from "../lib/biz-doc";

// 모두 지어낸 번호(검증번호만 맞춤) — 실제 사업자 아님
const OWN = "1234567891"; // 우리 회사
const A = "1112223339"; // 거래처 A
const B = "9876543215"; // 거래처 B

const party = (p: Partial<BizParty>): BizParty => ({
  role: "holder",
  business_no: null,
  name: null,
  representative: null,
  address: null,
  business_type: null,
  business_item: null,
  email: null,
  phone: null,
  ...p,
});

test("사업자번호 검증번호 — 맞음·틀림·형식", () => {
  assert.equal(isValidBizNo(OWN), true);
  assert.equal(isValidBizNo("123-45-67891"), true);
  assert.equal(isValidBizNo("5554432103"), true);
  assert.equal(isValidBizNo("1234567890"), false); // 마지막 자리 틀림
  assert.equal(isValidBizNo("0000000000"), false); // 빈 번호
  assert.equal(isValidBizNo("123456789"), false);
  assert.equal(isValidBizNo(null), false);
});

test("인식 결과 다듬기 — 번호 숫자만·13자리 버림·이메일 소문자·빈 값 null", () => {
  const r = sanitizeReading({
    doc_type: "tax_invoice",
    parties: [
      { role: "supplier", business_no: "123-45-67891", name: "  우리철강  ", representative: "홍길동", address: null, business_type: "도매", business_item: "철강재", email: " Sales@Own.CO.KR ", phone: "없음" },
      { role: "buyer", business_no: "110111-1234567", name: "(주)가나건설", representative: null, address: "경북 경주시 어딘가 1", business_type: null, business_item: null, email: "not-an-email", phone: "054-123-4567" },
    ],
    note: "",
  });
  assert.equal(r.docType, "tax_invoice");
  assert.equal(r.parties.length, 2);
  assert.deepEqual(r.parties[0], party({ role: "supplier", business_no: OWN, name: "우리철강", representative: "홍길동", business_type: "도매", business_item: "철강재", email: "sales@own.co.kr" }));
  assert.equal(r.parties[1].business_no, null); // 13자리(법인등록번호 형식)는 사업자번호가 아니다
  assert.equal(r.parties[1].email, null);
  assert.equal(r.parties[1].phone, "0541234567");
  assert.equal(r.note, null);
});

test("인식 결과 다듬기 — 사업자등록증은 한 곳만(holder)·모르는 종류는 other·이름도 번호도 없으면 뺌", () => {
  const cert = sanitizeReading({
    doc_type: "biz_registration",
    parties: [
      { role: "supplier", business_no: A, name: "가나상사" },
      { role: "buyer", business_no: B, name: "다라상사" },
    ],
  });
  assert.equal(cert.parties.length, 1);
  assert.equal(cert.parties[0].role, "holder");
  assert.equal(cert.parties[0].name, "가나상사");

  const odd = sanitizeReading({ doc_type: "receipt", parties: [{ role: "holder", name: null, business_no: "12" }, "x", null] });
  assert.equal(odd.docType, "other");
  assert.equal(odd.parties.length, 0);
  assert.deepEqual(sanitizeReading(null), { docType: "other", parties: [], note: null });

  const twice = sanitizeReading({ doc_type: "tax_invoice", parties: [{ role: "buyer", name: "첫째" }, { role: "buyer", name: "둘째" }] });
  assert.deepEqual(twice.parties.map((p) => p.name), ["첫째"]);
});

test("거래처 쪽 고르기 — 우리가 공급자면 공급받는자, 반대면 공급자", () => {
  const own = [{ business_no: OWN, name: "우리철강" }, { business_no: null, name: "(주)우리법인" }];
  const sell = { docType: "tax_invoice" as const, note: null, parties: [party({ role: "supplier", business_no: OWN, name: "우리철강" }), party({ role: "buyer", business_no: A, name: "가나상사" })] };
  assert.deepEqual(pickCounterparty(sell, own), { kind: "picked", party: sell.parties[1] });

  const buy = { ...sell, parties: [party({ role: "supplier", business_no: B, name: "다라상사" }), party({ role: "buyer", business_no: OWN, name: "우리철강" })] };
  assert.deepEqual(pickCounterparty(buy, own), { kind: "picked", party: buy.parties[0] });

  // 번호를 못 읽은 우리 쪽은 상호(회사 표기 무시)로 알아본다
  const noNo = { ...sell, parties: [party({ role: "supplier", name: "우리법인 주식회사" }), party({ role: "buyer", business_no: A, name: "가나상사" })] };
  assert.equal(pickCounterparty(noNo, own).kind, "picked");

  const neither = { ...sell, parties: [party({ role: "supplier", business_no: A, name: "가나상사" }), party({ role: "buyer", business_no: B, name: "다라상사" })] };
  assert.equal(pickCounterparty(neither, own).kind, "choose");

  const ownOnly = { ...sell, parties: [party({ role: "holder", business_no: OWN, name: "우리철강" })] };
  assert.deepEqual(pickCounterparty(ownOnly, own), { kind: "own_only" });
  assert.deepEqual(pickCounterparty({ ...sell, parties: [] }, own), { kind: "none" });
});

test("거래처 칸으로 옮기기 — 업태·종목은 따로, 자동 등록은 상호 + 맞는 번호일 때만", () => {
  const f = partnerFieldsOf(party({ business_no: A, name: "가나상사", business_type: "도매및소매업", business_item: "철강재, 건축자재" }));
  assert.equal(f.business_type, "도매및소매업");
  assert.equal(f.business_item, "철강재, 건축자재");
  assert.equal(partnerFieldsOf(party({ name: "가", business_item: "철근" })).business_type, null);
  assert.equal(canAutoRegister(f), true);
  assert.equal(canAutoRegister({ name: "가나상사", business_no: "1234567890" }), false);
  assert.equal(canAutoRegister({ name: null, business_no: A }), false);
  assert.equal(canAutoRegister({ name: "가나상사", business_no: null }), false);
});

test("빈 칸만 채우기 — 적힌 값·이름은 그대로, 대시만 있는 번호는 빈 칸, 업태·종목은 칸마다", () => {
  const fields = {
    name: "(주)가나상사",
    business_no: A,
    representative: "김대표",
    address: "경주시 1",
    business_type: "도매",
    business_item: "철강",
    email: "a@b.kr",
    phone: "0541234567",
  };
  const { patch, filled } = fillEmpty(
    { name: "가나상사", business_no: "---", representative: "이미적힘", address: "", business_type: "건설업", business_item: " ", email: undefined, phone: "010-1111-2222" },
    fields,
  );
  assert.deepEqual(filled, ["business_no", "address", "business_item", "email"]);
  assert.deepEqual(patch, { business_no: A, address: "경주시 1", business_item: "철강", email: "a@b.kr" });
});

test("업태·종목 목록 다듬기 — 겹친 항목은 한 번만, 공백 정리, 100자 넘는 항목부터 뺌", () => {
  // 사업자등록증은 종목마다 업태를 되풀이한다
  assert.equal(bizListText("건설업, 건설업,건설업 , 부동산업 및 임대업"), "건설업, 부동산업 및 임대업");
  assert.equal(bizListText("  도매  및   소매업 "), "도매 및 소매업");
  assert.equal(bizListText(" , ,"), null);
  assert.equal(bizListText(null), null);
  const long = Array.from({ length: 30 }, (_, i) => `종목${i}`).join(", ");
  const cut = bizListText(long) ?? "";
  assert.ok(cut.length <= BIZ_TYPE_ITEM_MAX);
  assert.ok(cut.endsWith(`종목${cut.split(", ").length - 1}`)); // 항목 중간에서 자르지 않음
  assert.equal(bizListText("가".repeat(150))?.length, BIZ_TYPE_ITEM_MAX); // 한 항목이 넘으면 그것만 자름
});

test("인식 결과 다듬기 — 업태·종목 목록도 겹친 항목을 한 번만", () => {
  const r = sanitizeReading({
    doc_type: "biz_registration",
    parties: [{ role: "holder", business_no: A, name: "가나건설", business_type: "건설업, 건설업, 부동산업", business_item: "건축공사업, 토목공사업, 건축공사업" }],
  });
  assert.equal(r.parties[0].business_type, "건설업, 부동산업");
  assert.equal(r.parties[0].business_item, "건축공사업, 토목공사업");
});

test("사업자번호 충돌·서류 분류", () => {
  assert.equal(bizNoConflicts("111-22-23339", A), false);
  assert.equal(bizNoConflicts(A, B), true);
  assert.equal(bizNoConflicts(null, B), false);
  assert.equal(bizNoConflicts(A, null), false);
  assert.equal(docKindOf("biz_registration"), "biz_cert");
  assert.equal(docKindOf("invoice"), "tax_invoice");
  assert.equal(docKindOf("tax_invoice"), "tax_invoice");
  assert.equal(docKindOf("business_card"), "other");
});
