-- ============================================================
-- 0073_quote_source_project.sql
-- 발주 레이더 v2 2주차 — 견적 ↔ 레이더 행 연결.
--
--  quote.source_project_id: 레이더 행([견적] 버튼)에서 만든 견적의 출처. 용도:
--   1) 견적서 문자(MMS) 가드 — 레이더 발 견적은 그 행·계정에 '견적 요청' 기록이 있어야 발송(수신자 요청, 정보통신망법 §50 취지)
--   2) 판정 지표 — 레이더 유래 견적·매출(sale.source_quote_id → quote.source_project_id) 집계(D10·4주 말)
--  create_quote_with_lines 를 재정의해 같은 트랜잭션에 기록(최신 정의 0064 + source_project_id 한 컬럼).
-- ============================================================

ALTER TABLE quote
  ADD COLUMN IF NOT EXISTS source_project_id UUID REFERENCES construction_project(id);
COMMENT ON COLUMN quote.source_project_id IS '발주 레이더 행에서 만든 견적의 출처(construction_project). 문자 가드·레이더 유래 매출 집계용';

CREATE INDEX IF NOT EXISTS idx_quote_source_project
  ON quote (source_project_id)
  WHERE source_project_id IS NOT NULL AND deleted_at IS NULL;

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
    subtotal_krw, vat_krw, total_krw, status, delivery_terms, payment_terms, notes,
    source_project_id
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
    NULLIF(p_quote->>'notes',''),
    NULLIF(p_quote->>'source_project_id','')::uuid
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

NOTIFY pgrst, 'reload schema';
