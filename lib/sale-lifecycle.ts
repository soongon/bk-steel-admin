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
  // 납품 done: 상태머신만(delivered/settled/overdue). 납품일 도래·지남은 자동완료가 아니다 —
  // '납품완료' 버튼으로만 완료되고, 날짜는 D-day 표시(deliveryDday)로만 쓴다.
  const delivered = ["delivered", "settled", "overdue"].includes(s.status);
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

/**
 * 납품일 기준 D-day — 미래 'D-n'(예정)/당일 'D-0'/지남 'D+n'.
 * deliveredOn·today 는 'YYYY-MM-DD'(KST). 실제 납품 완료 여부와 무관한 '표시용'이다.
 */
export function deliveryDday(deliveredOn: string, today: string): { dday: number; label: string } {
  const dday = Math.round((new Date(deliveredOn).getTime() - new Date(today).getTime()) / 86_400_000);
  const label = dday > 0 ? `D-${dday}` : dday === 0 ? "D-0" : `D+${-dday}`;
  return { dday, label };
}
