-- ============================================================
-- 0079_lead_source.sql
-- 유입경로(lead_source) — "어디 보고 연락했는지"를 매입견적서·영업내역에 남긴다.
--   · 배경: 중고철근 매입 문의가 홈페이지·네이버 블로그를 보고 들어오는데 그 비중을 잴 칸이 없었다
--     (docs/중고철근_매입_인바운드_강화_기획.md §3.1). sales_log.channel 은 접촉 수단(전화/방문)이지 유입 출처가 아니다.
--   · 값: homepage(홈페이지) / blog(네이버 블로그) / naver_place(네이버 플레이스) / referral(소개) / repeat(재거래)
--         / ad(광고) / other(기타). 모름·미입력은 NULL(목록에 '미기록'으로 보인다). enum 대신 TEXT + CHECK — 값 추가가 잦다.
--   · lead_note: 검색어·소개자·광고 키워드 등 자유 텍스트.
--   · 기존 행은 NULL 그대로(백필 없음). RPC create/update_purchase_quote_with_lines 가 두 컬럼을 받도록 0076 본문을 다시 정의.
-- ============================================================

ALTER TABLE purchase_quote ADD COLUMN IF NOT EXISTS lead_source TEXT;
ALTER TABLE purchase_quote ADD COLUMN IF NOT EXISTS lead_note   TEXT;
ALTER TABLE purchase_quote DROP CONSTRAINT IF EXISTS chk_pq_lead_source;
ALTER TABLE purchase_quote ADD CONSTRAINT chk_pq_lead_source CHECK (
  lead_source IS NULL OR lead_source IN ('homepage','blog','naver_place','referral','repeat','ad','other')
);
COMMENT ON COLUMN purchase_quote.lead_source IS '유입경로 — homepage/blog/naver_place/referral/repeat/ad/other. NULL=미기록 (0079)';
COMMENT ON COLUMN purchase_quote.lead_note   IS '유입 메모 — 검색어·소개자·광고 키워드 등 (0079)';
CREATE INDEX IF NOT EXISTS idx_purchase_quote_lead_source
  ON purchase_quote(lead_source, quote_date DESC) WHERE deleted_at IS NULL;

ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS lead_source TEXT;
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS lead_note   TEXT;
ALTER TABLE sales_log DROP CONSTRAINT IF EXISTS chk_sales_log_lead_source;
ALTER TABLE sales_log ADD CONSTRAINT chk_sales_log_lead_source CHECK (
  lead_source IS NULL OR lead_source IN ('homepage','blog','naver_place','referral','repeat','ad','other')
);
COMMENT ON COLUMN sales_log.lead_source IS '유입경로(인바운드일 때) — purchase_quote.lead_source 와 같은 값. 콜드 아웃바운드는 NULL (0079)';
COMMENT ON COLUMN sales_log.lead_note   IS '유입 메모 — 검색어·소개자 등 (0079)';

-- ---- 생성 (0076 + lead_source·lead_note) ----
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
    weighing_terms, delivery_terms, payment_terms, notes, status,
    lead_source, lead_note, created_by, updated_by
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
    NULLIF(p_quote->>'lead_source',''),
    NULLIF(p_quote->>'lead_note',''),
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

-- ---- 수정 (0076 + lead_source·lead_note) ----
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
    lead_source    = NULLIF(p_quote->>'lead_source',''),
    lead_note      = NULLIF(p_quote->>'lead_note',''),
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
