// 매입 거래 라이프사이클 진행률 — 상세 패널·목록 배지 공용.
// 4단계: 발주 → 입고 → 계산서 수취 → 결제. (매입은 받는 쪽이라 명세표·확인서 없음)

export type PurchaseLifecycleInput = {
  status: string;
  delivered_on: string | null;
  paid_on: string | null;
  tax_invoice_received_on: string | null;
  is_documented: boolean;
  tax_doc_type: string;
};

/**
 * 4단계 중 완료 수. 발주는 항상 완료, status가 ordered가 아니면(또는 입고일 있으면) 입고 완료,
 * 무자료(is_documented=false 또는 tax_doc_type='none')는 계산서 단계 자동 완료(해당없음).
 */
export function purchaseLifecycleProgress(p: PurchaseLifecycleInput): { done: number; total: number } {
  const received = p.status !== "ordered" || !!p.delivered_on;
  const invoiceNA = !p.is_documented || p.tax_doc_type === "none";
  let done = 1; // 발주
  if (received) done++;
  if (p.tax_invoice_received_on || invoiceNA) done++;
  if (p.paid_on) done++;
  return { done, total: 4 };
}
