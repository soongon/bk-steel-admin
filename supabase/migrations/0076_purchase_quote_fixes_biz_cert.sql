-- ============================================================
-- 0076_purchase_quote_fixes_biz_cert.sql
-- (1) 회사정보에 사업자등록증 이미지 URL — 인감·계좌사본(0066)과 동일 패턴, company-stamps 버킷(biz- 접두).
-- (2) 매입견적 리뷰 반영:
--   · 채번을 DB 로 이동 — 앱의 count 기반 채번은 RLS 가시 범위만 세어 책 권한이 제한된 사용자가 UNIQUE 충돌.
--     next_purchase_quote_doc_no(date) SECURITY DEFINER + advisory lock 으로 PQ{YYYYMMDD}-NNN 원자 채번.
--   · update RPC: status='done'(매입 등록 완료) 견적은 수정 거부, site_id 는 빈 값이면 보존.
--   · created_by / updated_by 를 auth.uid() 로 기록.
-- ============================================================

ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS biz_cert_url text;
COMMENT ON COLUMN company_profile.biz_cert_url IS '사업자등록증 이미지 공개 URL. company-stamps 버킷.';

-- ---- 채번 ----
CREATE OR REPLACE FUNCTION next_purchase_quote_doc_no(p_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefix text := 'PQ' || to_char(p_date, 'YYYYMMDD') || '-';
  v_next   int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('purchase_quote_doc_no:' || v_prefix));
  SELECT COALESCE(MAX(substring(doc_no from '(\d+)$')::int), 0) + 1
    INTO v_next
    FROM purchase_quote
   WHERE doc_no LIKE v_prefix || '%';
  RETURN v_prefix || lpad(v_next::text, 3, '0');
END;
$$;
REVOKE ALL ON FUNCTION next_purchase_quote_doc_no(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_purchase_quote_doc_no(date) TO authenticated;

-- ---- 생성 (0075 + 채번·created_by) ----
CREATE OR REPLACE FUNCTION create_purchase_quote_with_lines(p_quote jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id     uuid;
  v_book   book_type := (p_quote->>'book')::book_type;
  v_date   date := (p_quote->>'quote_date')::date;
  v_doc_no text := NULLIF(p_quote->>'doc_no','');
  v_line   jsonb;
  v_i      int := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '매입견적 품목 라인이 비어 있습니다';
  END IF;
  IF v_doc_no IS NULL THEN
    v_doc_no := next_purchase_quote_doc_no(v_date);
  END IF;

  INSERT INTO purchase_quote (
    book, doc_no, partner_id, prospect_name, site_id, site_name,
    quote_date, valid_until, is_documented,
    weighing_terms, delivery_terms, payment_terms, notes, status, created_by, updated_by
  ) VALUES (
    v_book,
    v_doc_no,
    NULLIF(p_quote->>'partner_id','')::uuid,
    NULLIF(p_quote->>'prospect_name',''),
    NULLIF(p_quote->>'site_id','')::uuid,
    NULLIF(p_quote->>'site_name',''),
    v_date,
    NULLIF(p_quote->>'valid_until','')::date,
    COALESCE((p_quote->>'is_documented')::boolean, TRUE),
    NULLIF(p_quote->>'weighing_terms',''),
    NULLIF(p_quote->>'delivery_terms',''),
    NULLIF(p_quote->>'payment_terms',''),
    NULLIF(p_quote->>'notes',''),
    COALESCE((p_quote->>'status')::purchase_quote_status, 'draft'),
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO purchase_quote_line (
      purchase_quote_id, book, sort_order, item_id, display_name, spec_text, price_per_kg_krw, notes
    ) VALUES (
      v_id, v_book, v_i,
      NULLIF(v_line->>'item_id','')::uuid,
      v_line->>'display_name',
      NULLIF(v_line->>'spec_text',''),
      (v_line->>'price_per_kg_krw')::numeric,
      NULLIF(v_line->>'notes','')
    );
    v_i := v_i + 1;
  END LOOP;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION create_purchase_quote_with_lines(jsonb, jsonb) TO authenticated;

-- ---- 수정 (0075 + done 가드·site_id 보존·updated_by) ----
CREATE OR REPLACE FUNCTION update_purchase_quote_with_lines(p_quote_id uuid, p_quote jsonb, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_book   book_type;
  v_status purchase_quote_status;
  v_line   jsonb;
  v_i      int := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '매입견적 품목 라인이 비어 있습니다';
  END IF;

  SELECT status INTO v_status FROM purchase_quote WHERE id = p_quote_id AND deleted_at IS NULL;
  IF v_status IS NULL THEN
    RAISE EXCEPTION '매입견적을 찾을 수 없습니다';
  END IF;
  IF v_status = 'done' THEN
    RAISE EXCEPTION '매입 완료된 견적은 수정할 수 없습니다';
  END IF;

  UPDATE purchase_quote SET
    partner_id     = NULLIF(p_quote->>'partner_id','')::uuid,
    prospect_name  = NULLIF(p_quote->>'prospect_name',''),
    site_id        = COALESCE(NULLIF(p_quote->>'site_id','')::uuid, site_id),
    site_name      = NULLIF(p_quote->>'site_name',''),
    quote_date     = (p_quote->>'quote_date')::date,
    valid_until    = NULLIF(p_quote->>'valid_until','')::date,
    is_documented  = COALESCE((p_quote->>'is_documented')::boolean, TRUE),
    weighing_terms = NULLIF(p_quote->>'weighing_terms',''),
    delivery_terms = NULLIF(p_quote->>'delivery_terms',''),
    payment_terms  = NULLIF(p_quote->>'payment_terms',''),
    notes          = NULLIF(p_quote->>'notes',''),
    updated_by     = auth.uid()
  WHERE id = p_quote_id AND deleted_at IS NULL
  RETURNING book INTO v_book;
  IF v_book IS NULL THEN
    RAISE EXCEPTION '매입견적을 수정할 권한이 없습니다';
  END IF;

  DELETE FROM purchase_quote_line WHERE purchase_quote_id = p_quote_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO purchase_quote_line (
      purchase_quote_id, book, sort_order, item_id, display_name, spec_text, price_per_kg_krw, notes
    ) VALUES (
      p_quote_id, v_book, v_i,
      NULLIF(v_line->>'item_id','')::uuid,
      v_line->>'display_name',
      NULLIF(v_line->>'spec_text',''),
      (v_line->>'price_per_kg_krw')::numeric,
      NULLIF(v_line->>'notes','')
    );
    v_i := v_i + 1;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION update_purchase_quote_with_lines(uuid, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
