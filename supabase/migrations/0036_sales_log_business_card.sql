-- ============================================================
-- 0036_sales_log_business_card.sql
-- sales_log → business_card 역방향 추적 FK.
-- 명함 페이지에서 "영업내역으로" 액션 시 prefill 신규 INSERT 후
-- 어느 명함에서 비롯됐는지 추적용 (명함 카드의 "영업 N건" 카운트 기반).
-- ============================================================

ALTER TABLE sales_log
  ADD COLUMN IF NOT EXISTS business_card_id UUID
    REFERENCES business_card(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_log_business_card
  ON sales_log(business_card_id)
  WHERE business_card_id IS NOT NULL AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
