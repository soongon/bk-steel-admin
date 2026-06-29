-- ============================================================
-- 0061_quote_line_manual_amount.sql
-- 견적 라인 '금액 직접입력'(운송비 포함 등 — 단가 대신 라인 총액 지정) 영구 저장.
-- 견적은 수정(라인 재계산·재저장)이 있어, line_subtotal 만으론 '직접입력' 여부를 못 살려
-- 수정 시 단가×수량으로 되돌아간다(ton_metric 과 동일 유형). manual_amount 컬럼으로 보존.
-- create/update_quote_with_lines 에 manual_amount 저장 추가(0060 미러 + manual_amount).
-- ============================================================

ALTER TABLE quote_line ADD COLUMN IF NOT EXISTS manual_amount numeric;
COMMENT ON COLUMN quote_line.manual_amount IS '금액 직접입력(운송비 포함 등) 시 라인 총액(원). null이면 단가×수량/중량 자동.';

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
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, ton_metric, manual_amount
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
      NULLIF(v_line->>'manual_amount','')::numeric
    );
  END LOOP;

  RETURN v_quote_id;
END;
$$;
GRANT EXECUTE ON FUNCTION create_quote_with_lines(jsonb, jsonb) TO authenticated;

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
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, ton_metric, manual_amount
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
      NULLIF(v_line->>'manual_amount','')::numeric
    );
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION update_quote_with_lines(uuid, jsonb, jsonb) TO authenticated;
