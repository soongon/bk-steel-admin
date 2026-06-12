// 매출 거래 라이프사이클 진행률 — 상세 패널(SaleLifecyclePanel)·목록 배지 공용.
// 6단계: 주문 → 납품 → 명세표 송부 → 계산서 발행 → 수금 → 납품확인서.

export type SaleLifecycleInput = {
  status: string;
  delivered_on: string | null;
  settled_on: string | null;
  statement_sent_on: string | null;
  tax_invoice_issued_on: string | null;
  delivery_cert_id: string | null;
  is_documented: boolean;
  tax_doc_type: string;
};

/**
 * 6단계 중 완료 수. 주문은 항상 완료, 무자료(is_documented=false 또는 tax_doc_type='none')는
 * 계산서 단계를 자동 완료(해당없음) 처리.
 */
export function saleLifecycleProgress(s: SaleLifecycleInput): { done: number; total: number } {
  const delivered = ["delivered", "settled", "overdue"].includes(s.status) || !!s.delivered_on;
  const settled = s.status === "settled" || !!s.settled_on;
  const invoiceNA = !s.is_documented || s.tax_doc_type === "none";
  let done = 1; // 주문
  if (delivered) done++;
  if (s.statement_sent_on) done++;
  if (s.tax_invoice_issued_on || invoiceNA) done++;
  if (settled) done++;
  if (s.delivery_cert_id) done++;
  return { done, total: 6 };
}
