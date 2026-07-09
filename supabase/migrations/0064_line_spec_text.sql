-- ============================================================
-- 0064_line_spec_text.sql
-- 철제(비철근) 직접입력 라인의 규격 텍스트. 품명(display_name)과 규격(spec_text)을 분리해
-- 명세표·견적서·계산서의 '품목/규격' 컬럼에 각각 표기(예: 앵글(SS) / 75x75x6T 10M).
-- 철근은 규격을 rebar_spec_code 등으로 조합하므로 spec_text 미사용(null).
-- create_sale_with_lines / create_quote_with_lines / update_quote_with_lines 에 spec_text 저장 추가.
-- ============================================================

ALTER TABLE sale_line  ADD COLUMN IF NOT EXISTS spec_text text;
ALTER TABLE quote_line ADD COLUMN IF NOT EXISTS spec_text text;
COMMENT ON COLUMN sale_line.spec_text  IS '철제 직접입력 규격(예: 75x75x6T 10M). null이면 없음/철근은 조합.';
COMMENT ON COLUMN quote_line.spec_text IS '철제 직접입력 규격(예: 75x75x6T 10M). null이면 없음/철근은 조합.';

-- ---- create_sale_with_lines (0062 미러 + spec_text) ----
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
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, status, display_name, spec_text
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
      v_status,
      NULLIF(v_line->>'display_name',''),
      NULLIF(v_line->>'spec_text','')
    );
  END LOOP;

  RETURN v_sale_id;
END;
$$;
GRANT EXECUTE ON FUNCTION create_sale_with_lines(jsonb, jsonb) TO authenticated;

-- ---- create_quote_with_lines (0063 미러 + spec_text) ----
CREATE OR REPLACE FUNCTION create_quote_with_lines(p_quote jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_quote_id uuid;
  v_book     book_type := (p_quote->>'book')::book_type;
  v_line     jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '견적 품목 라인이 비어 있습니다';
  END IF;

  INSERT INTO quote (
    book, doc_no, partner_id, prospect_name, site_id, site_name,
    quote_date, valid_until, is_documented, vat_type, vat_rate,
    subtotal_krw, vat_krw, total_krw, status, delivery_terms, payment_terms, notes
  ) VALUES (
    v_book,
    p_quote->>'doc_no',
    NULLIF(p_quote->>'partner_id','')::uuid,
    NULLIF(p_quote->>'prospect_name',''),
    NULLIF(p_quote->>'site_id','')::uuid,
    NULLIF(p_quote->>'site_name',''),
    (p_quote->>'quote_date')::date,
    NULLIF(p_quote->>'valid_until','')::date,
    (p_quote->>'is_documented')::boolean,
    (p_quote->>'vat_type')::vat_type,
    (p_quote->>'vat_rate')::numeric,
    (p_quote->>'subtotal_krw')::numeric,
    (p_quote->>'vat_krw')::numeric,
    (p_quote->>'total_krw')::numeric,
    COALESCE((p_quote->>'status')::quote_status, 'draft'),
    NULLIF(p_quote->>'delivery_terms',''),
    NULLIF(p_quote->>'payment_terms',''),
    NULLIF(p_quote->>'notes','')
  )
  RETURNING id INTO v_quote_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO quote_line (
      quote_id, book, item_id, unit, qty, unit_price_krw,
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, ton_metric, manual_amount, display_name, spec_text
    ) VALUES (
      v_quote_id,
      v_book,
      (v_line->>'item_id')::uuid,
      (v_line->>'unit')::acquired_unit,
      (v_line->>'qty')::numeric,
      (v_line->>'unit_price_krw')::numeric,
      NULLIF(v_line->>'weight_kg','')::numeric,
      NULLIF(v_line->>'weight_kg','')::numeric,
      'theoretical',
      (v_line->>'line_subtotal_krw')::numeric,
      COALESCE((v_line->>'ton_metric')::boolean, false),
      NULLIF(v_line->>'manual_amount','')::numeric,
      NULLIF(v_line->>'display_name',''),
      NULLIF(v_line->>'spec_text','')
    );
  END LOOP;

  RETURN v_quote_id;
END;
$$;
GRANT EXECUTE ON FUNCTION create_quote_with_lines(jsonb, jsonb) TO authenticated;

-- ---- update_quote_with_lines (0063 미러 + spec_text) ----
CREATE OR REPLACE FUNCTION update_quote_with_lines(p_quote_id uuid, p_quote jsonb, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_book book_type;
  v_line jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '견적 품목 라인이 비어 있습니다';
  END IF;

  UPDATE quote SET
    partner_id     = NULLIF(p_quote->>'partner_id','')::uuid,
    prospect_name  = NULLIF(p_quote->>'prospect_name',''),
    site_id        = NULLIF(p_quote->>'site_id','')::uuid,
    site_name      = NULLIF(p_quote->>'site_name',''),
    quote_date     = (p_quote->>'quote_date')::date,
    valid_until    = NULLIF(p_quote->>'valid_until','')::date,
    is_documented  = (p_quote->>'is_documented')::boolean,
    vat_type       = (p_quote->>'vat_type')::vat_type,
    vat_rate       = (p_quote->>'vat_rate')::numeric,
    subtotal_krw   = (p_quote->>'subtotal_krw')::numeric,
    vat_krw        = (p_quote->>'vat_krw')::numeric,
    total_krw      = (p_quote->>'total_krw')::numeric,
    delivery_terms = NULLIF(p_quote->>'delivery_terms',''),
    payment_terms  = NULLIF(p_quote->>'payment_terms',''),
    notes          = NULLIF(p_quote->>'notes','')
  WHERE id = p_quote_id AND deleted_at IS NULL
  RETURNING book INTO v_book;
  IF v_book IS NULL THEN
    RAISE EXCEPTION '견적을 찾을 수 없습니다';
  END IF;

  DELETE FROM quote_line WHERE quote_id = p_quote_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO quote_line (
      quote_id, book, item_id, unit, qty, unit_price_krw,
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, ton_metric, manual_amount, display_name, spec_text
    ) VALUES (
      p_quote_id,
      v_book,
      (v_line->>'item_id')::uuid,
      (v_line->>'unit')::acquired_unit,
      (v_line->>'qty')::numeric,
      (v_line->>'unit_price_krw')::numeric,
      NULLIF(v_line->>'weight_kg','')::numeric,
      NULLIF(v_line->>'weight_kg','')::numeric,
      'theoretical',
      (v_line->>'line_subtotal_krw')::numeric,
      COALESCE((v_line->>'ton_metric')::boolean, false),
      NULLIF(v_line->>'manual_amount','')::numeric,
      NULLIF(v_line->>'display_name',''),
      NULLIF(v_line->>'spec_text','')
    );
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION update_quote_with_lines(uuid, jsonb, jsonb) TO authenticated;
