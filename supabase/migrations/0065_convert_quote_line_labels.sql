-- ============================================================
-- 0065_convert_quote_line_labels.sql
-- 견적 → 매출 전환 시 quote_line 의 display_name(품명)·spec_text(규격)를 sale_line 으로 복사.
-- 0053 RPC 는 이 두 컬럼을 안 넘겨서, 철제 직접입력 견적을 매출로 전환하면 명세표 품목이
-- '철제(직접입력)'·규격 공백으로 나왔다. 0053 미러 + display_name·spec_text 추가.
-- ============================================================

CREATE OR REPLACE FUNCTION convert_quote_to_sale(p_quote_id uuid, p_overrides jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_quote      quote%ROWTYPE;
  v_sale_id    uuid;
  v_partner_id uuid;
  v_status     sale_status := COALESCE((p_overrides->>'status')::sale_status, 'reserved');
BEGIN
  SELECT * INTO v_quote FROM quote WHERE id = p_quote_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '견적을 찾을 수 없습니다';
  END IF;
  IF v_quote.status = 'won' THEN
    RAISE EXCEPTION '이미 수주 전환된 견적입니다';
  END IF;

  v_partner_id := COALESCE(NULLIF(p_overrides->>'partner_id','')::uuid, v_quote.partner_id);
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION '수주 전환에는 거래처가 필요합니다(견적에 거래처가 없으면 전환 시 선택)';
  END IF;

  INSERT INTO sale (
    book, doc_no, partner_id, site_id, site_name, sale_subtype,
    ordered_on, delivered_on, is_documented, tax_doc_type, vat_type, vat_rate,
    subtotal_krw, vat_krw, total_krw, payment_due_on, status, notes, source_quote_id
  ) VALUES (
    v_quote.book,
    p_overrides->>'doc_no',
    v_partner_id,
    v_quote.site_id,
    v_quote.site_name,
    'external',
    COALESCE(NULLIF(p_overrides->>'ordered_on','')::date, CURRENT_DATE),
    NULLIF(p_overrides->>'delivered_on','')::date,
    v_quote.is_documented,
    (p_overrides->>'tax_doc_type')::tax_doc_type,
    v_quote.vat_type,
    v_quote.vat_rate,
    v_quote.subtotal_krw,
    v_quote.vat_krw,
    v_quote.total_krw,
    NULLIF(p_overrides->>'payment_due_on','')::date,
    v_status,
    v_quote.notes,
    p_quote_id
  )
  RETURNING id INTO v_sale_id;

  -- 견적 라인 → 매출 라인 스냅샷 복사 (품명·규격 라벨 포함).
  INSERT INTO sale_line (
    sale_id, book, item_id, unit, qty, unit_price_krw,
    weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, status, display_name, spec_text
  )
  SELECT
    v_sale_id, ql.book, ql.item_id, ql.unit, ql.qty, ql.unit_price_krw,
    ql.weight_kg, ql.theoretical_weight_kg, ql.price_basis, ql.line_subtotal_krw, v_status,
    ql.display_name, ql.spec_text
  FROM quote_line ql
  WHERE ql.quote_id = p_quote_id AND ql.deleted_at IS NULL;

  UPDATE quote SET status = 'won' WHERE id = p_quote_id;

  RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION convert_quote_to_sale(uuid, jsonb) TO authenticated;
