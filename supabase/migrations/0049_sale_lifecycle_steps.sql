-- ============================================================
-- 0049_sale_lifecycle_steps.sql
-- 매출 거래 라이프사이클 추적 — 거래명세표 송부일·계산서(세금계산서) 발행일.
-- 주문/납품/수금/납품확인서는 기존 필드(ordered_on·delivered_on·settled_on·delivery_cert_id)로 도출.
-- 명세표·계산서는 추적 필드가 없어 신규 추가(토글 = 날짜 set/null).
-- ============================================================

ALTER TABLE sale ADD COLUMN IF NOT EXISTS statement_sent_on     DATE;  -- 거래명세표 송부일
ALTER TABLE sale ADD COLUMN IF NOT EXISTS tax_invoice_issued_on DATE;  -- 세금계산서 발행일
