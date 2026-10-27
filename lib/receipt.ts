// 영수증·비용(receipt) 목록 공용 상수·헬퍼 — client-safe.
// 참조: docs/시스템_DB_스키마_v1.md §13, supabase/migrations/0014_receipt.sql, 0092(origin)

import { TAX_DOC_OPTIONS } from "@/lib/tax-doc";

/** receipt.pay_method 값 → 표시. 값이 비어 있으면 '미지급'(결제 처리 전). */
export const RECEIPT_PAY_METHOD_LABEL: Record<string, string> = {
  card: "카드",
  cash: "현금",
  bank_transfer: "계좌이체",
};

/** tax_doc_type → 표시(폼 옵션과 같은 라벨). */
export const TAX_DOC_LABEL: Record<string, string> = Object.fromEntries(
  TAX_DOC_OPTIONS.map((o) => [o.value, o.label]),
);

export type ReceiptListRow = {
  id: string;
  book: "bk" | "sl" | "b";
  receipt_on: string;
  category: string;
  amount_krw: number;
  vat_included: boolean;
  tax_doc_type: string;
  tax_doc_no: string | null;
  pay_method: string | null;
  pay_bank_account_id: string | null;
  notes: string | null;
  /** 출처(0092) — hometax: 홈택스 매입 계산서 수집본에서 자동 생성 */
  origin: string | null;
  origin_ref: string | null;
  partner: { id: string; name: string; code: string } | null;
  pay_bank_account: { id: string; code: string; bank_name: string } | null;
};

/** 결제 처리가 안 된 건 — 결제수단·결제 통장이 둘 다 비어 있을 때. 홈택스 자동 생성 건은 처음엔 모두 미지급. */
export function isReceiptUnpaid(r: Pick<ReceiptListRow, "pay_method" | "pay_bank_account_id">): boolean {
  return !r.pay_method && !r.pay_bank_account_id;
}

/** 합계 줄 — 건수·금액 합·미지급 합·홈택스 생성 건수. */
export function summarizeReceipts(rows: ReceiptListRow[]) {
  let total = 0;
  let unpaid = 0;
  let unpaidCount = 0;
  let hometax = 0;
  for (const r of rows) {
    const amt = Number(r.amount_krw ?? 0);
    total += amt;
    if (isReceiptUnpaid(r)) {
      unpaid += amt;
      unpaidCount += 1;
    }
    if (r.origin === "hometax") hometax += 1;
  }
  return { count: rows.length, total, unpaid, unpaidCount, hometax };
}

// ── 월 필터(YYYY-MM) ──

export function isValidMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** 한국시간 기준 이번 달 'YYYY-MM' (서버가 UTC 여도 같게). */
export function kstCurrentMonth(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
}

/** YYYY-MM → [첫날, 다음 달 첫날) — receipt_on >= start AND < end 로 쓴다. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const end = m >= 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: `${month}-01`, end };
}

/** YYYY-MM 에 delta 개월 더하기(연 경계 처리). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
