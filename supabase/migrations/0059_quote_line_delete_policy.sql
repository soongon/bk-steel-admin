-- ============================================================
-- 0059_quote_line_delete_policy.sql
-- 견적 수정 치명 버그 수정:
--  · 0052 가 quote_line 에 select/insert/update 정책만 만들어 DELETE 가 RLS 로 차단됨.
--    → update_quote_with_lines 의 라인 교체(DELETE→INSERT)에서 기존 라인이 안 지워지고
--      새 라인만 추가되어 라인 중복·합계 오류. staff DELETE 정책 추가로 해결.
--  · update_quote_with_lines 가 quote_line.book 을 클라이언트값(p_quote->>'book')으로 쓰던 것을
--    quote 의 실제 book(UPDATE ... RETURNING)으로 바꿔 불일치 방지.
-- ============================================================

DROP POLICY IF EXISTS quote_line_delete ON quote_line;
CREATE POLICY quote_line_delete ON quote_line
  FOR DELETE USING (current_user_has_book_role(book, 'staff'));

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

  -- 헤더 update + 실제 book 회수(라인 book 에 사용 — 클라이언트값 불신).
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
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw
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
      (v_line->>'line_subtotal_krw')::numeric
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION update_quote_with_lines(uuid, jsonb, jsonb) TO authenticated;
