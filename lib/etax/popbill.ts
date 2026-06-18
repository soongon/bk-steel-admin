// 팝빌(Popbill) 전자세금계산서 어댑터 — lib/solapi.ts 패턴 미러(키 미설정 시 명확한 에러).
// CorpNum(발행 사업자번호)은 env 가 아니라 호출자가 supplier.corpNum 으로 전달 — 한 LinkHub
// 계정으로 법인(BK)·사업자(SL) 사업자번호를 각각 연동회원으로 두고 발행한다.
// 운영/테스트는 POPBILL_IS_TEST 로 분기(기본 true = 테스트베드, 국세청 실전송 없음).
import * as popbill from "popbill";
import type { EtaxProvider, EtaxIssueInput, EtaxState, EtaxStatus } from "./types";

const SELL = "SELL"; // MgtKeyType.SELL — 정발행(판매자 문서관리번호)

function isTest(): boolean {
  return process.env.POPBILL_IS_TEST !== "false"; // 기본 테스트베드
}

let configured = false;
function service() {
  const LinkID = process.env.POPBILL_LINK_ID;
  const SecretKey = process.env.POPBILL_SECRET_KEY;
  if (!LinkID || !SecretKey) {
    throw new Error("팝빌 연동키(POPBILL_LINK_ID·POPBILL_SECRET_KEY)가 설정되지 않았습니다.");
  }
  if (!configured) {
    popbill.config({ LinkID, SecretKey, IsTest: isTest() });
    configured = true;
  }
  return popbill.TaxinvoiceService();
}

/** 콜백(success/error) API → Promise. */
function promisify<T>(run: (s: (r: T) => void, e: (err: { message?: string }) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    run(resolve, (err) => reject(new Error(err?.message || "팝빌 처리 오류")));
  });
}

// 팝빌 stateCode 상세값은 테스트베드에서 최종 확정 필요. 국세청 승인번호(ntsconfirmNum) 유무를
// 1차 신호로 사용 — 발행 직후 'issued', 국세청 승인되면 'nts_approved'.
function mapStatus(info: { stateCode?: number; ntsconfirmNum?: string }): EtaxStatus {
  const nts = (info.ntsconfirmNum ?? "").trim() || null;
  const code = Number(info.stateCode ?? 0);
  let state: EtaxState = "issued";
  if (nts) state = "nts_approved";
  else if (code >= 400) state = "nts_sent";
  else if (code > 0 && code < 300) state = "issuing";
  return { state, ntsConfirmNum: nts, raw: info };
}

function buildTaxinvoice(input: EtaxIssueInput): Record<string, unknown> {
  const taxType = input.taxType === "free" ? "면세" : input.taxType === "zero" ? "영세" : "과세";
  const s = input.supplier;
  const b = input.buyer;
  return {
    writeDate: input.writeDate,
    chargeDirection: "정과금",
    issueType: "정발행",
    purposeType: input.purpose === "receipt" ? "영수" : "청구",
    taxType,
    // 공급자(발행자)
    invoicerCorpNum: s.corpNum,
    invoicerMgtKey: input.mgtKey,
    invoicerCorpName: s.name,
    invoicerCEOName: s.ceoName ?? "",
    invoicerAddr: s.addr ?? "",
    invoicerBizType: s.bizType ?? "",
    invoicerBizClass: s.bizClass ?? "",
    invoicerContactName: s.contactName ?? "",
    invoicerEmail: s.email ?? "",
    invoicerTEL: s.tel ?? "",
    // 공급받는자
    invoiceeType: "사업자",
    invoiceeCorpNum: b.corpNum,
    invoiceeCorpName: b.name,
    invoiceeCEOName: b.ceoName ?? "",
    invoiceeAddr: b.addr ?? "",
    invoiceeBizType: b.bizType ?? "",
    invoiceeBizClass: b.bizClass ?? "",
    invoiceeContactName1: b.contactName ?? "",
    invoiceeEmail1: b.email ?? "",
    invoiceeTEL1: b.tel ?? "",
    // 금액
    supplyCostTotal: String(Math.round(input.supplyCostTotal)),
    taxTotal: String(Math.round(input.taxTotal)),
    totalAmount: String(Math.round(input.totalAmount)),
    remark1: input.remark ?? "",
    detailList: input.lines.map((l) => ({
      serialNum: l.serialNum,
      purchaseDT: l.date,
      itemName: l.itemName,
      spec: l.spec ?? "",
      qty: l.qty != null ? String(l.qty) : "",
      unitCost: l.unitCost != null ? String(Math.round(l.unitCost)) : "",
      supplyCost: String(Math.round(l.supplyCost)),
      tax: String(Math.round(l.tax)),
      remark: l.remark ?? "",
    })),
  };
}

export const popbillProvider: EtaxProvider = {
  name: "popbill",
  get isTest() {
    return isTest();
  },
  async issue(input) {
    const svc = service();
    const ti = buildTaxinvoice(input);
    // registIssue(즉시발행) 성공 시점엔 국세청 승인번호 미발급 → 'issued'(접수). 승인번호는 getStatus 로 갱신.
    await promisify((s, e) => svc.registIssue(input.supplier.corpNum, ti, s, e));
    return { mgtKey: input.mgtKey, state: "issued", ntsConfirmNum: null, raw: { issued: true } };
  },
  async getStatus(corpNum, mgtKey) {
    const svc = service();
    const info = await promisify<{ stateCode?: number; ntsconfirmNum?: string }>((s, e) =>
      svc.getInfo(corpNum, SELL, mgtKey, "", s, e),
    );
    return mapStatus(info);
  },
  async cancel(corpNum, mgtKey, reason) {
    const svc = service();
    await promisify((s, e) => svc.cancelIssue(corpNum, SELL, mgtKey, reason || "발행취소", "", s, e));
    return { mgtKey, state: "cancelled", ntsConfirmNum: null, raw: { cancelled: true } };
  },
  async getPrintUrl(corpNum, mgtKey) {
    const svc = service();
    return promisify<string>((s, e) => svc.getPrintURL(corpNum, SELL, mgtKey, s, e));
  },
};
