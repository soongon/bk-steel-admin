/**
 * 홈택스 계산서 수집본 — 공용 타입 (DB: hometax_invoice / hometax_collection_job, 0084).
 * 기획: docs/홈택스_계산서_수집_연동_기획.md
 */
import type { Book } from "@/lib/book";

export type HometaxDirection = "sell" | "buy";
export type HometaxKind = "tax_invoice" | "invoice";
export type HometaxMatchStatus = "unmatched" | "candidate" | "matched" | "linked" | "mismatch" | "ignored";
export type HometaxDateType = "W" | "I" | "S"; // 작성일 / 발행일 / 전송일

export const HOMETAX_DIRECTIONS: ReadonlyArray<{ value: HometaxDirection; label: string; popbill: "SELL" | "BUY" }> = [
  { value: "sell", label: "매출", popbill: "SELL" },
  { value: "buy", label: "매입", popbill: "BUY" },
];

export const HOMETAX_MATCH_STATUS_LABEL: Record<HometaxMatchStatus, { label: string; cls: string }> = {
  unmatched: { label: "미매칭", cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
  candidate: { label: "후보", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  matched: { label: "일치", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  linked: { label: "연결됨", cls: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" },
  mismatch: { label: "불일치", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
  ignored: { label: "무시", cls: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800/60 dark:text-zinc-400" },
};

export const HOMETAX_DATE_TYPE_LABEL: Record<HometaxDateType, string> = { W: "작성일", I: "발행일", S: "전송일" };

/** 사업자(공급자·공급받는자·수탁자) 스냅샷 — 번호는 숫자만. */
export type HometaxParty = {
  biz_no: string;
  name: string | null;
  ceo: string | null;
  email: string | null;
  addr: string | null;
  tax_reg_id: string | null; // 종사업장번호
  type?: string | null; // 공급받는자 구분(사업자/개인/외국인)
};

export type HometaxItem = {
  serial: number | null;
  date: string | null; // YYYY-MM-DD
  name: string | null;
  spec: string | null;
  qty: number | null;
  unit_cost: number | null;
  supply: number | null;
  tax: number | null;
  remark: string | null;
};

/** hometax_invoice 행(수집 컬럼만 — upsert 에 쓰는 형태). 대사 컬럼은 포함하지 않는다. */
export type HometaxInvoiceInsert = {
  book: Book;
  direction: HometaxDirection;
  nts_confirm_num: string;
  kind: HometaxKind;
  tax_type: string | null;
  issue_type: string | null;
  purpose: string | null;
  modify_code: number | null;
  orig_nts_confirm_num: string | null;
  write_date: string;
  issue_date: string | null;
  send_date: string | null;
  supplier: HometaxParty;
  invoicee: HometaxParty;
  trustee: HometaxParty | null;
  supply_amount: number;
  tax_amount: number;
  total_amount: number;
  item_summary: string | null;
  items: HometaxItem[] | null;
  detail_fetched_at: string | null;
  raw: { abbr: unknown; detail?: unknown };
  source: "popbill" | "excel";
};

export type HometaxInvoiceRow = HometaxInvoiceInsert & {
  id: string;
  collected_at: string;
  match_status: HometaxMatchStatus;
  sale_id: string | null;
  purchase_id: string | null;
  tax_invoice_id: string | null;
  matched_at: string | null;
  ignore_reason: string | null;
  notes: string | null;
};

export type HometaxJobRow = {
  id: string;
  book: Book;
  direction: HometaxDirection;
  job_id: string | null;
  date_type: HometaxDateType;
  from_date: string;
  to_date: string;
  state: "requested" | "running" | "done" | "failed";
  found: number | null;
  inserted: number | null;
  updated: number | null;
  error: string | null;
  source: "cron" | "manual";
  requested_at: string;
  finished_at: string | null;
};
