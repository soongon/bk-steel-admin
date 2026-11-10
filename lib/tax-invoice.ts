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

/**
 * 팝빌 stateCode(3자리) 해석 — 발행취소 가능 여부 판단용.
 *  - 첫 자리 3 = 발행완료. 끝 자리 0 발행완료 · 1 전송전 · 2 전송대기 · 3 전송중 · 4 전송성공 · 5 전송실패(팝빌 응답코드표).
 *    전송중·전송성공이면 발행취소가 안 되고 수정세금계산서만 된다. 그 앞(0~2)·실패(5)는 팝빌에 취소를 맡긴다(거절되면 그 메시지).
 *  - transmitted = 전송성공(국세청 승인) — 상태 표시용.
 *  - 첫 자리 5·6 = 취소(팝빌 사이트 등 밖에서 이미 취소됨).
 * 승인번호(ntsconfirmNum)는 발행 즉시 붙으므로 '전송됨'의 신호가 아니다.
 */
export function popbillStateFlags(stateCode: number | null | undefined): { ntsSent: boolean; transmitted: boolean; cancelled: boolean } {
  const code = Number(stateCode ?? 0);
  const head = Math.floor(code / 100);
  const tail = code % 10;
  return {
    ntsSent: head === 3 && (tail === 3 || tail === 4),
    transmitted: head === 3 && tail === 4,
    cancelled: head === 5 || head === 6,
  };
}

/** 팝빌 오류 코드: 그 문서번호의 (세금)계산서가 없음. */
export const POPBILL_NO_SUCH_DOC = -11000005;

/**
 * 문서 조회(getInfo)가 오류로 끝났을 때 — '그 번호의 문서 없음'이면 false(안 쓰는 번호), 그 밖의 오류면 null(모름).
 * 모르면 호출자가 발행을 멈춘다: 연결 오류를 '안 쓰는 번호'로 읽으면 중복 발행이 된다.
 */
export function mgtKeyInUseFromError(err: { code?: number | string } | null | undefined): false | null {
  return Number(err?.code) === POPBILL_NO_SUCH_DOC ? false : null;
}

/** 계산서가 발행된 매출에 품목을 더할 때 — 계산서 종류·매출 상태별 안내(수정 창·계산서 창 공용). */
export function reissueHint(provider: string | null | undefined, settled: boolean): string {
  if (settled) return "수금완료된 매출은 금액을 바꿀 수 없습니다 — 추가분은 [신규 매출]로 따로 등록해 계산서를 따로 발행하세요.";
  if (provider === "hometax") return "홈택스에서 직접 발행한 계산서라 여기서 취소할 수 없습니다 — 추가분은 [신규 매출]로 따로 등록하거나, 홈택스에서 수정세금계산서를 발행하세요.";
  if (provider === "manual") return "[계산서]에서 기록을 취소한 뒤 품목을 고치고 새 계산서 번호로 다시 기록하세요(종이 계산서는 따로 재발행).";
  return "국세청 전송 전(보통 발행 당일)이면 [계산서] → [발행취소] 한 뒤 품목을 고쳐 다시 발행하세요. 전송 뒤면 추가분을 [신규 매출]로 따로 등록해 계산서를 따로 발행하세요.";
}

/** 팝빌 문서관리번호 최대 길이. */
export const MGT_KEY_MAX = 24;

/**
 * 계산서 문서관리번호 후보 — 처음은 `{base}`(예전과 같음), 다시 발행하면 `{base}-2`, `{base}-3` …
 * 팝빌은 발행취소된 문서의 번호도 계속 쥐고 있어서 같은 번호로 다시 발행할 수 없다. 24자를 넘으면 base 끝을 줄인다.
 */
export function mgtKeyCandidates(base: string, max = 30): string[] {
  const out: string[] = [];
  for (let n = 1; n <= max; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    out.push(base.slice(0, MGT_KEY_MAX - suffix.length) + suffix);
  }
  return out;
}
