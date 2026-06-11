-- ============================================================
-- 0047_multiline_pnl_delete_guard.sql
-- 멀티라인 매출 도입(0046) 후속 정합성 수정.
--   1) 월별 P&L 중복 — sale_line JOIN 으로 sale 헤더가 라인 수만큼 복제돼
--      SUM(s.subtotal_krw)가 라인 수배로 부풀던 버그(대시보드 매출 KPI). revenue/cogs 분리.
--   2) soft_delete_sale 이 sale_line 을 안 건드려(매입과 비대칭) 라인이 미삭제로 남음 → 라인 동반 삭제.
--   3) 수금완료(settled) 매출 / 결제완료(paid) 매입 삭제 가드 — 통장거래만 남는 불일치 방지.
-- ============================================================

-- ------------------------------------------------------------
-- 1) 월별 P&L (내부 관리용) — revenue 는 sale 단위, cogs 는 allocation 단위로 분리 집계.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW vw_book_monthly_pnl_internal WITH (security_invoker = true) AS
WITH rev AS (
  SELECT book, DATE_TRUNC('month', ordered_on)::DATE AS month,
         SUM(subtotal_krw) AS revenue_krw
  FROM sale
  WHERE deleted_at IS NULL AND status NOT IN ('cancelled')
  GROUP BY book, DATE_TRUNC('month', ordered_on)
),
cogs AS (
  SELECT s.book, DATE_TRUNC('month', s.ordered_on)::DATE AS month,
         SUM(alloc.cost_krw) AS cogs_krw
  FROM sale s
  JOIN sale_line sl ON sl.sale_id = s.id AND sl.deleted_at IS NULL
  JOIN sale_line_allocation alloc ON alloc.sale_line_id = sl.id
  WHERE s.deleted_at IS NULL AND s.status NOT IN ('cancelled')
  GROUP BY s.book, DATE_TRUNC('month', s.ordered_on)
)
SELECT
  rev.book,
  rev.month,
  rev.revenue_krw,
  COALESCE(cogs.cogs_krw, 0)                       AS cogs_krw,
  rev.revenue_krw - COALESCE(cogs.cogs_krw, 0)     AS gross_profit_krw
FROM rev
LEFT JOIN cogs ON cogs.book = rev.book AND cogs.month = rev.month;

-- ------------------------------------------------------------
-- 2) 월별 P&L (신고용) — 동일 분리. BK 전체 + SL documented, B 자동 제외.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW vw_book_monthly_pnl_filing WITH (security_invoker = true) AS
WITH rev AS (
  SELECT book, DATE_TRUNC('month', ordered_on)::DATE AS month,
         SUM(subtotal_krw) AS revenue_krw,
         SUM(vat_krw)      AS vat_krw
  FROM sale
  WHERE deleted_at IS NULL AND status NOT IN ('cancelled')
    AND is_documented = TRUE AND book IN ('bk','sl')
  GROUP BY book, DATE_TRUNC('month', ordered_on)
),
cogs AS (
  SELECT s.book, DATE_TRUNC('month', s.ordered_on)::DATE AS month,
         SUM(alloc.cost_krw) AS cogs_krw
  FROM sale s
  JOIN sale_line sl ON sl.sale_id = s.id AND sl.deleted_at IS NULL
  JOIN sale_line_allocation alloc ON alloc.sale_line_id = sl.id
  WHERE s.deleted_at IS NULL AND s.status NOT IN ('cancelled')
    AND s.is_documented = TRUE AND s.book IN ('bk','sl')
  GROUP BY s.book, DATE_TRUNC('month', s.ordered_on)
)
SELECT
  rev.book,
  rev.month,
  rev.revenue_krw,
  rev.vat_krw,
  COALESCE(cogs.cogs_krw, 0)                       AS cogs_krw,
  rev.revenue_krw - COALESCE(cogs.cogs_krw, 0)     AS gross_profit_krw
FROM rev
LEFT JOIN cogs ON cogs.book = rev.book AND cogs.month = rev.month;

-- ------------------------------------------------------------
-- 3) 매출 soft-delete — 라인 동반 삭제(매입과 대칭) + 수금완료 가드.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_sale(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_book   book_type;
  v_status sale_status;
BEGIN
  SELECT book, status INTO v_book, v_status FROM sale WHERE id = p_id AND deleted_at IS NULL;
  IF v_book IS NULL THEN
    RAISE EXCEPTION '매출을 찾을 수 없습니다';
  END IF;
  IF NOT current_user_has_book_role(v_book, 'manager') THEN
    RAISE EXCEPTION '삭제 권한이 없습니다 (manager 이상 필요)';
  END IF;
  IF v_status = 'settled' THEN
    RAISE EXCEPTION '수금완료된 매출은 삭제할 수 없습니다(먼저 수금/입금을 취소하세요)';
  END IF;
  -- 라인도 함께 soft-delete — 라인 직접 조회·집계 정합(매입 soft_delete_purchase 와 대칭).
  UPDATE sale_line SET deleted_at = NOW() WHERE sale_id = p_id AND deleted_at IS NULL;
  UPDATE sale SET deleted_at = NOW() WHERE id = p_id;
END;
$$;

-- ------------------------------------------------------------
-- 4) 매입 soft-delete — 기존(라인 동반) + 결제완료 가드 추가(매출과 대칭).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_purchase(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_book book_type;
  v_paid date;
BEGIN
  SELECT book, paid_on INTO v_book, v_paid FROM purchase WHERE id = p_id AND deleted_at IS NULL;
  IF v_book IS NULL THEN
    RAISE EXCEPTION '매입을 찾을 수 없습니다';
  END IF;
  IF NOT current_user_has_book_role(v_book, 'manager') THEN
    RAISE EXCEPTION '삭제 권한이 없습니다 (manager 이상 필요)';
  END IF;
  IF v_paid IS NOT NULL THEN
    RAISE EXCEPTION '결제완료된 매입은 삭제할 수 없습니다(먼저 결제/출금을 취소하세요)';
  END IF;
  -- 라인(=재고 lot)도 함께 soft-delete — vw_inventory 유령 재고 방지(매입 고유).
  UPDATE purchase_line SET deleted_at = NOW() WHERE purchase_id = p_id AND deleted_at IS NULL;
  UPDATE purchase SET deleted_at = NOW() WHERE id = p_id;
END;
$$;
