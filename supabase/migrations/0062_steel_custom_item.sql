-- ============================================================
-- 0062_steel_custom_item.sql
-- 철제(비철근) 직접입력용 공용 placeholder 품목.
-- 철제는 품목이 다양해 마스터를 다 만들지 않고, 이 공용 item 하나에 sale_line/quote_line 의
-- display_name 으로 실제 품목명을 저장한다(명세표·계산서 표시는 display_name). item_id FK 는
-- NOT NULL 이라 자유텍스트만으론 저장 불가 → 이 고정 item 을 참조.
-- 고정 UUID 로 시드(앱에서 상수 참조). category=etc, 단위중량 없음(단가·수량 직접입력).
-- ============================================================

INSERT INTO item (id, code, name, category, spec_text, is_active)
VALUES (
  '00000000-0000-0000-0000-0000000057ee'::uuid,  -- STEEL_CUSTOM 고정 id
  'STEEL_CUSTOM',
  '철제(직접입력)',
  'etc',
  NULL,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE;

-- create_sale_with_lines 에 display_name 저장 추가(0046 미러 + display_name).
-- 기존엔 라인 INSERT 후 별도 set_sale_line_display_names 로만 채웠는데, 철제 직접입력은
-- 생성 시점에 바로 저장되어야 명세표·계산서에 즉시 반영된다.
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
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, status, display_name
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
      NULLIF(v_line->>'display_name','')
    );
  END LOOP;

  RETURN v_sale_id;
END;
$$;
GRANT EXECUTE ON FUNCTION create_sale_with_lines(jsonb, jsonb) TO authenticated;
