-- ============================================================
-- 0018_views.sql
-- 운영·결산·시세·신고 view (모두 SECURITY INVOKER — RLS 자연 적용)
-- 참조: docs/시스템_DB_스키마_v1.md §11·§12·§17
-- ============================================================

-- ============================================================
-- 1. 재고 ledger view (purchase_line - sale_line_allocation)
-- ============================================================
CREATE OR REPLACE VIEW vw_inventory WITH (security_invoker = true) AS
SELECT
  pl.id                                            AS purchase_line_id,
  pl.book,
  pl.warehouse_id,
  pl.warehouse_zone_id,
  pl.item_id,
  pl.acquired_unit,
  pl.acquired_qty,
  pl.acquired_qty - COALESCE(SUM(a.allocated_qty), 0)               AS remaining_qty,
  pl.theoretical_weight_kg,
  pl.actual_weight_kg,
  COALESCE(pl.actual_weight_kg, pl.theoretical_weight_kg, 0)
    - COALESCE(SUM(a.allocated_weight_kg), 0)                       AS remaining_weight_kg,
  pl.unit_price_krw,
  pl.grade, pl.length_mm, pl.bars_count,
  pl.status,
  pl.created_at                                                     AS acquired_at
FROM purchase_line pl
LEFT JOIN sale_line_allocation a ON a.purchase_line_id = pl.id
WHERE pl.deleted_at IS NULL
  AND pl.status NOT IN ('transferred_out','scrapped')
GROUP BY pl.id
HAVING pl.acquired_qty - COALESCE(SUM(a.allocated_qty), 0) > 0;

-- ============================================================
-- 2. 책·품목별 재고 요약
-- ============================================================
CREATE OR REPLACE VIEW vw_inventory_by_book_item WITH (security_invoker = true) AS
SELECT
  book,
  item_id,
  SUM(remaining_qty)       AS total_qty,
  SUM(remaining_weight_kg) AS total_weight_kg,
  COUNT(*)                 AS line_count
FROM vw_inventory
GROUP BY book, item_id;

-- ============================================================
-- 3. 오늘의 시가 (manual > external > purchase_derived 우선순위)
-- 최근 90일 내 가장 최근 값을 carry-over
-- ============================================================
CREATE OR REPLACE VIEW vw_today_market_price WITH (security_invoker = true) AS
WITH ranked AS (
  SELECT
    ph.*,
    ROW_NUMBER() OVER (
      PARTITION BY market_item_id, recorded_on
      ORDER BY CASE source
        WHEN 'manual'           THEN 1
        WHEN 'external'         THEN 2
        WHEN 'purchase_derived' THEN 3
      END
    ) AS rnk
  FROM price_history ph
  WHERE recorded_on >= CURRENT_DATE - INTERVAL '90 days'
)
SELECT DISTINCT ON (market_item_id)
  market_item_id, recorded_on, price_per_unit, unit, price_type, source
FROM ranked
WHERE rnk = 1
ORDER BY market_item_id, recorded_on DESC;

-- ============================================================
-- 4. 재고 시가 평가 (책별 자산가치)
-- ============================================================
CREATE OR REPLACE VIEW vw_inventory_valuation WITH (security_invoker = true) AS
SELECT
  inv.book,
  inv.item_id,
  inv.total_weight_kg,
  tp.price_per_unit                                AS market_price_per_kg,
  inv.total_weight_kg * COALESCE(tp.price_per_unit, 0) AS valuation_krw
FROM vw_inventory_by_book_item inv
JOIN item i ON i.id = inv.item_id
LEFT JOIN vw_today_market_price tp ON tp.market_item_id = i.market_item_id;

-- ============================================================
-- 5. 미수금 (sale 기반, 등급 자동 계산)
-- ============================================================
CREATE OR REPLACE VIEW vw_receivable WITH (security_invoker = true) AS
SELECT
  s.id           AS sale_id,
  s.book,
  s.partner_id,
  s.doc_no,
  s.ordered_on,
  s.delivered_on,
  s.payment_due_on,
  s.settled_on,
  s.total_krw,
  COALESCE(SUM(bt.amount_krw) FILTER (WHERE bt.amount_krw > 0), 0) AS received_krw,
  s.total_krw - COALESCE(SUM(bt.amount_krw) FILTER (WHERE bt.amount_krw > 0), 0) AS outstanding_krw,
  CASE
    WHEN s.status = 'settled' THEN NULL
    WHEN s.payment_due_on IS NULL OR s.payment_due_on >= CURRENT_DATE THEN 'normal'::receivable_grade
    WHEN CURRENT_DATE - s.payment_due_on BETWEEN 1 AND 7 THEN 'short'::receivable_grade
    WHEN CURRENT_DATE - s.payment_due_on BETWEEN 8 AND 30 THEN 'mid'::receivable_grade
    ELSE 'long'::receivable_grade
  END                                              AS grade,
  CURRENT_DATE - s.payment_due_on                  AS days_overdue
FROM sale s
LEFT JOIN bank_transaction bt
  ON bt.sale_id = s.id AND bt.deleted_at IS NULL
WHERE s.deleted_at IS NULL AND s.status NOT IN ('cancelled')
GROUP BY s.id;

-- ============================================================
-- 6. 외상매입금 (purchase 기반)
-- ============================================================
CREATE OR REPLACE VIEW vw_payable WITH (security_invoker = true) AS
SELECT
  p.id          AS purchase_id,
  p.book,
  p.partner_id,
  p.doc_no,
  p.ordered_on,
  p.delivered_on,
  p.payment_due_on,
  p.paid_on,
  p.total_krw,
  -- 매입 결제 = 통장 출금(음수)
  COALESCE(SUM(-bt.amount_krw) FILTER (WHERE bt.amount_krw < 0), 0) AS paid_krw,
  p.total_krw - COALESCE(SUM(-bt.amount_krw) FILTER (WHERE bt.amount_krw < 0), 0) AS outstanding_krw,
  CASE
    WHEN p.paid_on IS NOT NULL THEN NULL
    WHEN p.payment_due_on IS NULL OR p.payment_due_on >= CURRENT_DATE THEN 'normal'::receivable_grade
    WHEN CURRENT_DATE - p.payment_due_on BETWEEN 1 AND 7 THEN 'short'::receivable_grade
    WHEN CURRENT_DATE - p.payment_due_on BETWEEN 8 AND 30 THEN 'mid'::receivable_grade
    ELSE 'long'::receivable_grade
  END                                              AS grade,
  CURRENT_DATE - p.payment_due_on                  AS days_overdue
FROM purchase p
LEFT JOIN bank_transaction bt
  ON bt.purchase_id = p.id AND bt.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id;

-- ============================================================
-- 7. 책별 월별 P&L — 내부 관리용 (B 포함, 자료성 무관)
-- ============================================================
CREATE OR REPLACE VIEW vw_book_monthly_pnl_internal WITH (security_invoker = true) AS
SELECT
  s.book,
  DATE_TRUNC('month', s.ordered_on)::DATE   AS month,
  SUM(s.subtotal_krw)                       AS revenue_krw,
  COALESCE(SUM(alloc.cost_krw), 0)          AS cogs_krw,
  SUM(s.subtotal_krw) - COALESCE(SUM(alloc.cost_krw), 0) AS gross_profit_krw
FROM sale s
LEFT JOIN sale_line sl
  ON sl.sale_id = s.id AND sl.deleted_at IS NULL
LEFT JOIN sale_line_allocation alloc
  ON alloc.sale_line_id = sl.id
WHERE s.deleted_at IS NULL
  AND s.status NOT IN ('cancelled')
GROUP BY s.book, DATE_TRUNC('month', s.ordered_on);

-- ============================================================
-- 8. 책별 월별 P&L — 신고용 (BK 전체 + SL documented, B 자동 제외)
-- ============================================================
CREATE OR REPLACE VIEW vw_book_monthly_pnl_filing WITH (security_invoker = true) AS
SELECT
  s.book,
  DATE_TRUNC('month', s.ordered_on)::DATE   AS month,
  SUM(s.subtotal_krw)                       AS revenue_krw,
  SUM(s.vat_krw)                            AS vat_krw,
  COALESCE(SUM(alloc.cost_krw), 0)          AS cogs_krw,
  SUM(s.subtotal_krw) - COALESCE(SUM(alloc.cost_krw), 0) AS gross_profit_krw
FROM sale s
LEFT JOIN sale_line sl
  ON sl.sale_id = s.id AND sl.deleted_at IS NULL
LEFT JOIN sale_line_allocation alloc
  ON alloc.sale_line_id = sl.id
WHERE s.deleted_at IS NULL
  AND s.status NOT IN ('cancelled')
  AND s.is_documented = TRUE
  AND s.book IN ('bk','sl')
GROUP BY s.book, DATE_TRUNC('month', s.ordered_on);

-- ============================================================
-- 9. 부가세 신고 후보 (BK + SL의 자료거래만)
-- ============================================================
CREATE OR REPLACE VIEW vw_vat_eligible_sale WITH (security_invoker = true) AS
SELECT *
FROM sale
WHERE deleted_at IS NULL
  AND is_documented = TRUE
  AND book IN ('bk','sl')
  AND vat_type IN ('standard_10','zero_rated');

CREATE OR REPLACE VIEW vw_vat_eligible_purchase WITH (security_invoker = true) AS
SELECT *
FROM purchase
WHERE deleted_at IS NULL
  AND is_documented = TRUE
  AND book IN ('bk','sl')
  AND vat_type IN ('standard_10','zero_rated');
