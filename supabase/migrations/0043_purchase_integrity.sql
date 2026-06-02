-- ============================================================
-- 0043_purchase_integrity.sql
-- 매입 무결성 — 매출(0041·0042)과 동일 패턴 미러:
--   원자적 생성 RPC · 삭제 권한 RPC · 결제↔통장 출금 연동 RPC · 법인 자료종류 CHECK 강화
-- ============================================================

-- ------------------------------------------------------------
-- 1) 원자적 매입 생성 — 헤더 + 라인 한 트랜잭션.
--    창고/존(warehouse_id·zone_id)은 액션이 미리 해석해 전달. SECURITY INVOKER.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_purchase_with_line(p_purchase jsonb, p_line jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_purchase_id uuid;
  v_book        book_type := (p_purchase->>'book')::book_type;
  v_status      purchase_status := (p_purchase->>'status')::purchase_status;
BEGIN
  INSERT INTO purchase (
    book, doc_no, partner_id, purchase_subtype,
    ordered_on, delivered_on, is_documented, tax_doc_type, tax_doc_no, vat_type, vat_rate,
    subtotal_krw, vat_krw, total_krw, payment_due_on, paid_on, status, notes
  ) VALUES (
    v_book,
    p_purchase->>'doc_no',
    (p_purchase->>'partner_id')::uuid,
    'external',
    (p_purchase->>'ordered_on')::date,
    NULLIF(p_purchase->>'delivered_on','')::date,
    (p_purchase->>'is_documented')::boolean,
    (p_purchase->>'tax_doc_type')::tax_doc_type,
    NULLIF(p_purchase->>'tax_doc_no',''),
    (p_purchase->>'vat_type')::vat_type,
    (p_purchase->>'vat_rate')::numeric,
    (p_purchase->>'subtotal_krw')::numeric,
    (p_purchase->>'vat_krw')::numeric,
    (p_purchase->>'total_krw')::numeric,
    NULLIF(p_purchase->>'payment_due_on','')::date,
    NULLIF(p_purchase->>'paid_on','')::date,
    v_status,
    NULLIF(p_purchase->>'notes','')
  )
  RETURNING id INTO v_purchase_id;

  INSERT INTO purchase_line (
    purchase_id, book, warehouse_id, warehouse_zone_id, item_id,
    acquired_unit, acquired_qty, unit_price_krw, bars_count,
    theoretical_weight_kg, actual_weight_kg, invoiced_weight_kg,
    price_basis, line_subtotal_krw, status
  ) VALUES (
    v_purchase_id,
    v_book,
    (p_line->>'warehouse_id')::uuid,
    NULLIF(p_line->>'warehouse_zone_id','')::uuid,
    (p_line->>'item_id')::uuid,
    (p_line->>'acquired_unit')::acquired_unit,
    (p_line->>'acquired_qty')::numeric,
    (p_line->>'unit_price_krw')::numeric,
    NULLIF(p_line->>'bars_count','')::int,
    NULLIF(p_line->>'theoretical_weight_kg','')::numeric,
    NULLIF(p_line->>'actual_weight_kg','')::numeric,
    NULLIF(p_line->>'invoiced_weight_kg','')::numeric,
    (p_line->>'price_basis')::price_basis,
    (p_line->>'line_subtotal_krw')::numeric,
    (p_line->>'line_status')::purchase_status
  );

  RETURN v_purchase_id;
END;
$$;

-- ------------------------------------------------------------
-- 2) 매입 soft-delete — manager 이상만(매출과 동일).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_purchase(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_book book_type;
BEGIN
  SELECT book INTO v_book FROM purchase WHERE id = p_id AND deleted_at IS NULL;
  IF v_book IS NULL THEN
    RAISE EXCEPTION '매입을 찾을 수 없습니다';
  END IF;
  IF NOT current_user_has_book_role(v_book, 'manager') THEN
    RAISE EXCEPTION '삭제 권한이 없습니다 (manager 이상 필요)';
  END IF;
  -- 라인(=재고 lot)도 함께 soft-delete — 안 하면 vw_inventory 에 유령 재고로 남음(매입 고유).
  UPDATE purchase_line SET deleted_at = NOW() WHERE purchase_id = p_id AND deleted_at IS NULL;
  UPDATE purchase SET deleted_at = NOW() WHERE id = p_id;
END;
$$;

-- ------------------------------------------------------------
-- 3) 결제완료 ↔ 통장 출금 연동(매출 settle 미러). 음수 amount = 출금.
--    통장.book = 매입.book 정합 강제. 이미 결제(paid_on)면 차단.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pay_purchase_with_payment(
  p_purchase_id      uuid,
  p_bank_account_id  uuid,
  p_paid_on          date
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pur           purchase%ROWTYPE;
  v_acct_book     book_type;
  v_acct_active   boolean;
  v_partner_name  text;
BEGIN
  -- FOR UPDATE: 동시 두 요청이 같은 paid_on=null 을 보고 중복 출금하는 race 차단.
  SELECT * INTO v_pur FROM purchase WHERE id = p_purchase_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '매입을 찾을 수 없습니다';
  END IF;
  IF v_pur.paid_on IS NOT NULL THEN
    RAISE EXCEPTION '이미 결제완료된 매입입니다 (결제일: %)', v_pur.paid_on;
  END IF;

  SELECT book, is_active INTO v_acct_book, v_acct_active
  FROM bank_account WHERE id = p_bank_account_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '통장을 찾을 수 없습니다';
  END IF;
  IF NOT v_acct_active THEN
    RAISE EXCEPTION '비활성 통장으로는 결제할 수 없습니다';
  END IF;
  IF v_acct_book <> v_pur.book THEN
    RAISE EXCEPTION '매입(%)과 통장(%)의 책이 다릅니다 — 3축 정합 위반', v_pur.book, v_acct_book;
  END IF;

  SELECT name INTO v_partner_name FROM partner WHERE id = v_pur.partner_id;

  -- 출금 거래(음수 = 출금)
  INSERT INTO bank_transaction (
    bank_account_id, book, txn_on, amount_krw, counterparty, partner_id, purchase_id, notes
  ) VALUES (
    p_bank_account_id, v_pur.book, p_paid_on, -v_pur.total_krw,
    v_partner_name, v_pur.partner_id, p_purchase_id,
    '매입 결제 [' || v_pur.doc_no || ']'
  );

  UPDATE purchase
  SET paid_on = p_paid_on, pay_bank_account_id = p_bank_account_id
  WHERE id = p_purchase_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_purchase_with_line(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION soft_delete_purchase(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pay_purchase_with_payment(uuid, uuid, date) TO authenticated;

-- ------------------------------------------------------------
-- 4) 법인(bk) 자료종류 CHECK 강화 — 매출과 동일(위반행 0 확인).
-- ------------------------------------------------------------
ALTER TABLE purchase DROP CONSTRAINT IF EXISTS chk_bk_documented;
ALTER TABLE purchase ADD CONSTRAINT chk_bk_documented CHECK (
  book <> 'bk'
  OR (is_documented = TRUE AND tax_doc_type NOT IN ('none', 'simple_receipt'))
);
