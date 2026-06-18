// 세금계산서 발행 — 클라이언트·서버 공용 순수 헬퍼(상태 라벨·발행 분기·발행 가드).
// ASP 연동(lib/etax)·DB 쓰기(RPC)는 서버에서만. 여기는 enum 라벨과 분기 로직만.

export type TaxInvoiceState =
  | "draft"
  | "issuing"
  | "issued"
  | "nts_sent"
  | "nts_approved"
  | "failed"
  | "cancelled";

export const TAX_INVOICE_STATE_KO: Record<TaxInvoiceState, string> = {
  draft: "작성",
  issuing: "발행 중",
  issued: "발행됨",
  nts_sent: "국세청 전송",
  nts_approved: "국세청 승인",
  failed: "발행 실패",
  cancelled: "발행 취소",
};

/** 발행 완료(실선상태)로 간주하는 상태 — 라이프사이클·sale 동기화 기준. */
export function isTaxInvoiceIssued(state: TaxInvoiceState | null | undefined): boolean {
  return state === "issued" || state === "nts_sent" || state === "nts_approved";
}

/**
 * 매출의 세금계산서 처리 모드.
 *  - electronic: 전자세금계산서 → ASP 실발행 대상
 *  - manual: 종이세금계산서·면세계산서 → 수기 번호/발행일 기록
 *  - none: 무자료·B계좌·현금영수증·간이영수증 → 세금계산서 해당없음
 */
export type TaxDocMode = "electronic" | "manual" | "none";

export function taxDocMode(book: string, isDocumented: boolean, taxDocType: string): TaxDocMode {
  if (book === "b" || !isDocumented || taxDocType === "none") return "none";
  if (taxDocType === "tax_invoice_electronic") return "electronic";
  if (taxDocType === "tax_invoice_paper" || taxDocType === "invoice") return "manual";
  return "none"; // cash_receipt, simple_receipt 는 세금계산서가 아님
}

/**
 * 전자세금계산서 발행을 막는 사유(없으면 null = 발행 가능).
 * 거래처 사업자등록번호는 발행 필수 — 없으면 발행 모달에서 입력받아 보강해야 한다.
 */
export function electronicIssueBlockReason(args: {
  book: string;
  isDocumented: boolean;
  taxDocType: string;
  buyerBusinessNo: string | null | undefined;
  alreadyIssued: boolean;
}): string | null {
  if (taxDocMode(args.book, args.isDocumented, args.taxDocType) !== "electronic") {
    return "전자세금계산서 대상이 아닙니다.";
  }
  if (args.alreadyIssued) return "이미 발행된 세금계산서가 있습니다.";
  if (!args.buyerBusinessNo || !args.buyerBusinessNo.trim()) {
    return "거래처 사업자등록번호가 없습니다 — 발행 전 입력하세요.";
  }
  return null;
}
