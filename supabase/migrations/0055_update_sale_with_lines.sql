-- ============================================================
-- 0055_update_sale_with_lines.sql
-- 매출 편집 시 품목 라인까지 수정 — 헤더 update + 라인 전체 교체(delete→insert) + 합계 반영.
-- 기존 sale_line 삭제 시 sale_line_allocation 은 ON DELETE CASCADE(0009)로 정리.
-- 재고는 view 계산(입고-출고)이라 라인 교체 후 자동 반영. create_sale_with_lines(0046) 미러.
-- 합계(subtotal/vat/total)는 앱에서 라인 합산해 p_sale 로 전달.
-- ============================================================

CREATE OR REPLACE FUNCTION update_sale_with_lines(p_sale_id uuid, p_sale jsonb, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_book   book_type := (p_sale->>'book')::book_type;
  v_status sale_status := (p_sale->>'status')::sale_status;
  v_line   jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '매출 품목 라인이 비어 있습니다';
  END IF;

  UPDATE sale SET
    site_id        = NULLIF(p_sale->>'site_id','')::uuid,
    site_name      = NULLIF(p_sale->>'site_name',''),
    delivered_on   = NULLIF(p_sale->>'delivered_on','')::date,
    is_documented  = (p_sale->>'is_documented')::boolean,
    tax_doc_type   = (p_sale->>'tax_doc_type')::tax_doc_type,
    vat_type       = (p_sale->>'vat_type')::vat_type,
    vat_rate       = (p_sale->>'vat_rate')::numeric,
    subtotal_krw   = (p_sale->>'subtotal_krw')::numeric,
    vat_krw        = (p_sale->>'vat_krw')::numeric,
    total_krw      = (p_sale->>'total_krw')::numeric,
    payment_due_on = NULLIF(p_sale->>'payment_due_on','')::date,
    status         = v_status,
    notes          = NULLIF(p_sale->>'notes','')
  WHERE id = p_sale_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '매출을 찾을 수 없습니다';
  END IF;

  -- 라인 전체 교체. allocation 은 CASCADE 로 정리, 라인 상태는 헤더 상태와 일치.
  DELETE FROM sale_line WHERE sale_id = p_sale_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO sale_line (
      sale_id, book, item_id, unit, qty, unit_price_krw,
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, status
    ) VALUES (
      p_sale_id,
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
END;
$$;

GRANT EXECUTE ON FUNCTION update_sale_with_lines(uuid, jsonb, jsonb) TO authenticated;
