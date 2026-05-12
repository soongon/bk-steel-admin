/**
 * 책(book) 도메인 상수
 *
 * 시스템 최상위 차원. 내부 코드는 'bk'/'sl'/'b', 화면 표시는 '법인'/'사업자'/'B계좌'.
 * 모든 거래성 데이터는 정확히 한 책에 속한다.
 *
 * 참조: docs/시스템_도메인_룰_v1.md §1
 */

export const BOOKS = ["bk", "sl", "b"] as const;
export type Book = (typeof BOOKS)[number];

export const BOOK_LABEL: Record<Book, string> = {
  bk: "법인",
  sl: "사업자",
  b: "B계좌",
};

/**
 * URL slug (책 선택). 'all'은 "권한 있는 모든 책 합집합" 뷰.
 * 데이터 입력 액션은 'all' 모드에서 책 선택을 강제해야 함.
 */
export const BOOK_VIEWS = ["all", "bk", "sl", "b"] as const;
export type BookView = (typeof BOOK_VIEWS)[number];

export const BOOK_VIEW_LABEL: Record<BookView, string> = {
  all: "전체",
  bk: "법인",
  sl: "사업자",
  b: "B계좌",
};

export const BOOK_VIEW_BADGE_CLASS: Record<BookView, string> = {
  all: "border-zinc-500/40 bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
  bk: "border-blue-500/50 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  sl: "border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  b: "border-red-500/60 bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
};

export function isValidBookView(value: unknown): value is BookView {
  return typeof value === "string" && (BOOK_VIEWS as readonly string[]).includes(value);
}

/**
 * 'all'을 제외한 실제 책인지. 데이터 입력 액션 검증용.
 */
export function isConcreteBook(view: BookView): view is Book {
  return view !== "all";
}

/**
 * 책별 시각 강조 (Tailwind 색상 키). UI 요소에서 색상 매핑 시 사용.
 *
 * - bk (법인) = blue: 정상거래 100%, 안정성 강조
 * - sl (사업자) = amber: 일반 운영
 * - b (B계좌) = red: 무자료, 시각 격리 + 주의 환기
 */
export const BOOK_COLOR: Record<Book, "blue" | "amber" | "red"> = {
  bk: "blue",
  sl: "amber",
  b: "red",
};

/**
 * 책별 BookBadge에 쓰는 Tailwind 클래스. 라이트/다크 모두 커버.
 */
export const BOOK_BADGE_CLASS: Record<Book, string> = {
  bk: "border-blue-500/50 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  sl: "border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  b: "border-red-500/60 bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
};

/**
 * 유효한 책 코드인지 검증 (라우트 가드 / 폼 검증용)
 */
export function isValidBook(value: unknown): value is Book {
  return typeof value === "string" && (BOOKS as readonly string[]).includes(value);
}

/**
 * 책 매트릭스 — 이관 가능 여부
 * 참조: docs/시스템_도메인_룰_v1.md §2
 */
export type TransferType = "inter_book_transfer" | "internal_reclass";

export function canTransfer(from: Book, to: Book): TransferType | null {
  if (from === to) return null;
  // BK ↔ SL: 정상거래
  if ((from === "bk" && to === "sl") || (from === "sl" && to === "bk")) {
    return "inter_book_transfer";
  }
  // SL ↔ B: 비공식 재분류
  if ((from === "sl" && to === "b") || (from === "b" && to === "sl")) {
    return "internal_reclass";
  }
  // BK ↔ B: 금지
  return null;
}
