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
  }

  export function TaxinvoiceService(): TaxinvoiceServiceInstance;
}
