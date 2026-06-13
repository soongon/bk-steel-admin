-- ============================================================
-- 0050_purchase_lifecycle_step.sql
-- 매입 거래 라이프사이클 — 세금계산서 수취일 추적.
-- 발주/입고/결제는 기존 필드(ordered_on·delivered_on·status·paid_on)로 도출.
-- 계산서 수취는 추적 필드가 없어 신규 추가(토글 = 날짜 set/null, 무자료는 '해당없음').
-- ============================================================

ALTER TABLE purchase ADD COLUMN IF NOT EXISTS tax_invoice_received_on DATE;  -- 세금계산서 수취일
