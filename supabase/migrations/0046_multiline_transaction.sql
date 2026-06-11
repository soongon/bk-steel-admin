-- ============================================================
-- 0046_multiline_transaction.sql
-- 매출/매입 멀티라인 — 한 거래에 여러 품목 라인을 원자적으로 생성.
-- 기존 단일 라인 RPC(0041 create_sale_with_line, 0045 create_purchase_with_line)를
-- p_lines jsonb 배열을 받아 loop INSERT 하는 *_with_lines 로 교체.
-- 헤더 합계(subtotal/vat/total)는 앱에서 라인 합산해 p_sale/p_purchase 로 전달.
-- ============================================================

-- ------------------------------------------------------------
-- 1) 원자적 매출 생성 (헤더 1 + 라인 N)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_sale_with_lines(p_sale jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_book    book_type := (p_sale->>'book')::book_type;
  v_status  sale_status := (p_sale->>'status')::sale_status;
  v_line    jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '매출 품목 라인이 비어 있습니다';
  END IF;

  INSERT INTO sale (
    book, doc_no, partner_id, site_id, site_name, sale_subtype,
    ordered_on, delivered_on, is_documented, tax_doc_type, vat_type, vat_rate,
    subtotal_krw, vat_krw, total_krw, payment_due_on, settled_on, status, notes
  ) VALUES (
    v_book,
    p_sale->>'doc_no',
    (p_sale->>'partner_id')::uuid,
    NULLIF(p_sale->>'site_id','')::uuid,
    NULLIF(p_sale->>'site_name',''),
    'external',
    (p_sale->>'ordered_on')::date,
    NULLIF(p_sale->>'delivered_on','')::date,
    (p_sale->>'is_documented')::boolean,
    (p_sale->>'tax_doc_type')::tax_doc_type,
    (p_sale->>'vat_type')::vat_type,
    (p_sale->>'vat_rate')::numeric,
    (p_sale->>'subtotal_krw')::numeric,
    (p_sale->>'vat_krw')::numeric,
    (p_sale->>'total_krw')::numeric,
    NULLIF(p_sale->>'payment_due_on','')::date,
    NULLIF(p_sale->>'settled_on','')::date,
    v_status,
    NULLIF(p_sale->>'notes','')
  )
  RETURNING id INTO v_sale_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO sale_line (
      sale_id, book, item_id, unit, qty, unit_price_krw,
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, status
    ) VALUES (
      v_sale_id,
      v_book,
      (v_line->>'item_id')::uuid,
      (v_line->>'unit')::acquired_unit,
      (v_line->>'qty')::numeric,
      (v_line->>'unit_price_krw')::numeric,
      NULLIF(v_line->>'weight_kg','')::numeric,
      NULLIF(v_line->>'weight_kg','')::numeric,
      'theoretical',
      (v_line->>'line_subtotal_krw')::numeric,
      v_status
    );
  END LOOP;

  RETURN v_sale_id;
END;
$$;

-- ------------------------------------------------------------
-- 2) 원자적 매입 생성 (헤더 1 + 라인 N)
--    warehouse_id/zone 은 라인마다 동일값(헤더 야적장)이 들어옴 — 앱이 각 라인에 주입.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_purchase_with_lines(p_purchase jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_purchase_id uuid;
  v_book        book_type := (p_purchase->>'book')::book_type;
  v_status      purchase_status := (p_purchase->>'status')::purchase_status;
  v_line        jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '매입 품목 라인이 비어 있습니다';
  END IF;

  INSERT INTO purchase (
    book, doc_no, partner_id, site_id, site_name, purchase_subtype,
    ordered_on, delivered_on, is_documented, tax_doc_type, tax_doc_no, vat_type, vat_rate,
    subtotal_krw, vat_krw, total_krw, payment_due_on, paid_on, status, notes
  ) VALUES (
    v_book,
    p_purchase->>'doc_no',
    (p_purchase->>'partner_id')::uuid,
    NULLIF(p_purchase->>'site_id','')::uuid,
    NULLIF(p_purchase->>'site_name',''),
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

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO purchase_line (
      purchase_id, book, warehouse_id, warehouse_zone_id, item_id,
      acquired_unit, acquired_qty, unit_price_krw, bars_count,
      theoretical_weight_kg, actual_weight_kg, invoiced_weight_kg,
      price_basis, line_subtotal_krw, status
    ) VALUES (
      v_purchase_id,
      v_book,
      (v_line->>'warehouse_id')::uuid,
      NULLIF(v_line->>'warehouse_zone_id','')::uuid,
      (v_line->>'item_id')::uuid,
      (v_line->>'acquired_unit')::acquired_unit,
      (v_line->>'acquired_qty')::numeric,
      (v_line->>'unit_price_krw')::numeric,
      NULLIF(v_line->>'bars_count','')::int,
      NULLIF(v_line->>'theoretical_weight_kg','')::numeric,
      NULLIF(v_line->>'actual_weight_kg','')::numeric,
      NULLIF(v_line->>'invoiced_weight_kg','')::numeric,
      (v_line->>'price_basis')::price_basis,
      (v_line->>'line_subtotal_krw')::numeric,
      (v_line->>'line_status')::purchase_status
    );
  END LOOP;

  RETURN v_purchase_id;
END;
$$;

-- 기존 단일 라인 함수 제거 (호출처가 서버액션뿐 — *_with_lines 로 전환). 혼동 방지.
DROP FUNCTION IF EXISTS create_sale_with_line(jsonb, jsonb);
DROP FUNCTION IF EXISTS create_purchase_with_line(jsonb, jsonb);

GRANT EXECUTE ON FUNCTION create_sale_with_lines(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase_with_lines(jsonb, jsonb) TO authenticated;
