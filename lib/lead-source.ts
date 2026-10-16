/**
 * 유입경로(lead_source) — "어디 보고 연락했는지". purchase_quote·sales_log 공용 (0079).
 * 값은 DB CHECK(chk_pq_lead_source / chk_sales_log_lead_source)와 같아야 한다. NULL = 미기록.
 */

export const LEAD_SOURCES = [
  { value: "homepage", label: "홈페이지", cls: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" },
  { value: "blog", label: "네이버 블로그", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  { value: "naver_place", label: "네이버 플레이스", cls: "bg-lime-100 text-lime-700 dark:bg-lime-950/50 dark:text-lime-300" },
  { value: "referral", label: "소개", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300" },
  { value: "repeat", label: "재거래", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  { value: "ad", label: "광고", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" },
  { value: "other", label: "기타", cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number]["value"];

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = Object.fromEntries(
  LEAD_SOURCES.map((s) => [s.value, s.label]),
) as Record<LeadSource, string>;

export const LEAD_SOURCE_CLS: Record<LeadSource, string> = Object.fromEntries(
  LEAD_SOURCES.map((s) => [s.value, s.cls]),
) as Record<LeadSource, string>;

export function isLeadSource(v: unknown): v is LeadSource {
  return typeof v === "string" && LEAD_SOURCES.some((s) => s.value === v);
}

/** 유입 메모 칸 placeholder — 경로별로 무엇을 적을지. 없는 경로(재거래)는 메모 칸을 숨긴다. */
export const LEAD_NOTE_PLACEHOLDER: Partial<Record<LeadSource, string>> = {
  homepage: "검색어·본 글 (선택, 예: '잔여철근 매입' 검색)",
  blog: "검색어·본 글 (선택, 예: 울산 120톤 글 보고)",
  naver_place: "검색어 (선택, 예: '경주 철근 매입')",
  referral: "소개한 분 (예: ○○철거 김소장)",
  ad: "광고 키워드 (예: 파워링크 '중고철근 매입')",
  other: "어디서 (예: 당근, 간판 보고, 명함)",
};

/** 목록 필터 쿼리값 — 경로값 또는 'none'(미기록). */
export const LEAD_FILTER_NONE = "none";
