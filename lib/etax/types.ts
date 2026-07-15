// 전자세금계산서 ASP 어댑터 — provider-agnostic 타입. 구현: popbill.ts(실연동) / mock.ts(개발).
// 거래 헤더/라인은 EtaxIssueInput 으로 정규화해 어댑터에 전달 — ASP 교체 시 어댑터만 교체.

export type EtaxParty = {
  corpNum: string; // 사업자등록번호(숫자만)
  name: string; // 상호
  ceoName: string | null; // 대표자
  addr: string | null; // 주소
  bizType: string | null; // 업태
  bizClass: string | null; // 종목
  contactName: string | null; // 담당자명
  email: string | null; // 담당자 이메일(팝빌 invoiceeEmail1 — 발행 시 자동 송부)
  email2?: string | null; // 2번째 담당자 이메일(발행 후 sendEmail 로 추가 전송)
  tel: string | null;
};

export type EtaxLine = {
  serialNum: number;
  date: string; // 거래일자 YYYYMMDD
  itemName: string;
  spec: string | null;
  qty: number | null;
  unitCost: number | null;
  supplyCost: number; // 공급가액
  tax: number; // 세액
  remark: string | null;
};

export type EtaxIssueInput = {
  mgtKey: string; // 문서관리번호(판매자 SELL)
  writeDate: string; // 작성일자 YYYYMMDD
  purpose: "charge" | "receipt"; // 청구 / 영수
  taxType: "taxable" | "zero" | "free"; // 과세 / 영세 / 면세
  supplier: EtaxParty; // 공급자(발행자 = ASP 연동회원)
  buyer: EtaxParty; // 공급받는자
  supplyCostTotal: number;
  taxTotal: number;
  totalAmount: number;
  itemSummary: string | null;
  remark: string | null;
  lines: EtaxLine[];
};

export type EtaxState = "issuing" | "issued" | "nts_sent" | "nts_approved" | "failed" | "cancelled";

export type EtaxResult = {
  mgtKey: string;
  state: EtaxState;
  ntsConfirmNum: string | null;
  raw: unknown;
};

export type EtaxStatus = {
  state: EtaxState;
  ntsConfirmNum: string | null;
  raw: unknown;
};

export interface EtaxProvider {
  readonly name: string;
  readonly isTest: boolean;
  issue(input: EtaxIssueInput): Promise<EtaxResult>;
  getStatus(corpNum: string, mgtKey: string): Promise<EtaxStatus>;
  cancel(corpNum: string, mgtKey: string, reason: string): Promise<EtaxResult>;
  getPrintUrl(corpNum: string, mgtKey: string): Promise<string>;
  /** 발행된 세금계산서를 지정 이메일로 (재)전송 — 2번째 수신처 등. */
  sendEmail(corpNum: string, mgtKey: string, receiver: string): Promise<void>;
}
