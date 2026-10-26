// 팝빌 Node SDK(popbill@1.64) 최소 타입 선언 — 공식 @types 없음. 우리가 쓰는 메서드만.
declare module "popbill" {
  export const MgtKeyType: { SELL: "SELL"; BUY: "BUY"; TRUSTEE: "TRUSTEE" };

  export function config(c: {
    LinkID: string;
    SecretKey: string;
    IsTest: boolean;
    defaultErrorHandler?: (err: { code?: number; message?: string }) => void;
  }): void;

  export type PopbillError = { code?: number; message?: string };
  export type PopbillResponse = { code: number; message: string };
  export type PopbillTaxinvoiceInfo = {
    stateCode?: number;
    ntsconfirmNum?: string;
    stateMemo?: string;
    [k: string]: unknown;
  };

  export interface TaxinvoiceServiceInstance {
    registIssue(
      corpNum: string,
      taxinvoice: Record<string, unknown>,
      success: (r: PopbillResponse) => void,
      error: (e: PopbillError) => void,
    ): void;
    getInfo(
      corpNum: string,
      keyType: string,
      mgtKey: string,
      userID: string,
      success: (r: PopbillTaxinvoiceInfo) => void,
      error: (e: PopbillError) => void,
    ): void;
    cancelIssue(
      corpNum: string,
      keyType: string,
      mgtKey: string,
      memo: string,
      userID: string,
      success: (r: PopbillResponse) => void,
      error: (e: PopbillError) => void,
    ): void;
    getPrintURL(
      corpNum: string,
      keyType: string,
      mgtKey: string,
      success: (url: string) => void,
      error: (e: PopbillError) => void,
    ): void;
    sendEmail(
      corpNum: string,
      keyType: string,
      mgtKey: string,
      receiver: string,
      userID: string,
      success: (r: PopbillResponse) => void,
      error: (e: PopbillError) => void,
    ): void;
  }

  export function TaxinvoiceService(): TaxinvoiceServiceInstance;

  // --- 문자(MessageService) — 우리가 쓰는 메서드만 ---
  export interface MessageServiceInstance {
    // sendMMS 짧은 폼: (CorpNum, Sender, Receiver, ReceiverName, Subject, Contents, FilePath, reserveDT, success, error)
    sendMMS(
      corpNum: string,
      sender: string,
      receiver: string,
      receiverName: string,
      subject: string,
      contents: string,
      filePath: string,
      reserveDT: string,
      success: (receiptNum: string) => void,
      error: (e: PopbillError) => void,
    ): void;
    getBalance(corpNum: string, success: (remainPoint: number) => void, error: (e: PopbillError) => void): void;
  }
  export function MessageService(): MessageServiceInstance;

  // --- 카카오 알림톡(KakaoService) — 우리가 쓰는 메서드만 ---
  export type KakaoButton = { n: string; t: string; u1?: string; u2?: string };
  export interface KakaoServiceInstance {
    // sendATS_one: (CorpNum, templateCode, Sender, content, altContent, altSendType, sndDT,
    //               receiver, receiverName, UserID, requestNum, btns, success, error)
    sendATS_one(
      corpNum: string,
      templateCode: string,
      sender: string,
      content: string,
      altContent: string,
      altSendType: string,
      sndDT: string,
      receiver: string,
      receiverName: string,
      userID: string,
      requestNum: string,
      btns: KakaoButton[] | null,
      success: (receiptNum: string) => void,
      error: (e: PopbillError) => void,
    ): void;
    getBalance(corpNum: string, success: (remainPoint: number) => void, error: (e: PopbillError) => void): void;
    getPlusFriendMgtURL(corpNum: string, userID: string, success: (url: string) => void, error: (e: PopbillError) => void): void;
    getSenderNumberMgtURL(corpNum: string, userID: string, success: (url: string) => void, error: (e: PopbillError) => void): void;
    getATSTemplateMgtURL(corpNum: string, userID: string, success: (url: string) => void, error: (e: PopbillError) => void): void;
  }
  export function KakaoService(): KakaoServiceInstance;

  // --- 홈택스 전자(세금)계산서 연계(HTTaxinvoiceService) — 우리가 쓰는 메서드만 (0084, lib/hometax) ---
  export type HTJobState = {
    jobID: string;
    jobState: number; // 1 대기, 2 진행, 3 완료
    queryType: string; // SELL / BUY / TRUSTEE
    jobStartDT?: string;
    jobEndDT?: string;
    collectCount?: number;
    regDT?: string;
    errorCode?: number;
    errorReason?: string;
  };
  export type HTSearchResult = {
    code: number;
    message?: string;
    total: number;
    perPage: number;
    pageNum: number;
    pageCount: number;
    list: Array<Record<string, unknown>>;
  };
  export interface HTTaxinvoiceServiceInstance {
    requestJob(
      corpNum: string,
      queryType: "SELL" | "BUY" | "TRUSTEE",
      dType: "W" | "I" | "S",
      sDate: string,
      eDate: string,
      success: (jobID: string) => void,
      error: (e: PopbillError) => void,
    ): void;
    getJobState(corpNum: string, jobID: string, success: (r: HTJobState) => void, error: (e: PopbillError) => void): void;
    search(
      corpNum: string,
      jobID: string,
      type: string[],
      taxType: string[],
      purposeType: string[],
      taxRegIDType: string,
      taxRegIDYN: string,
      taxRegID: string,
      page: number,
      perPage: number,
      order: "D" | "A",
      success: (r: HTSearchResult) => void,
      error: (e: PopbillError) => void,
    ): void;
    getTaxinvoice(corpNum: string, ntsConfirmNum: string, success: (r: Record<string, unknown>) => void, error: (e: PopbillError) => void): void;
    getFlatRateState(corpNum: string, success: (r: boolean | { flatRateState?: boolean }) => void, error: (e: PopbillError) => void): void;
    checkDeptUser(corpNum: string, success: (r: unknown) => void, error: (e: PopbillError) => void): void;
  }
  export function HTTaxinvoiceService(): HTTaxinvoiceServiceInstance;
}
