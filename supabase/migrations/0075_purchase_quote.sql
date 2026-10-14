-- ============================================================
-- 0075_purchase_quote.sql
-- 매입견적서 — 우리가 "사는 쪽"으로 상대(현장·철거업체·고철상 등 판매자)에게 보내는 kg당 매입 단가 견적.
--   · 총중량·총액은 당일 계근 후 확정되므로 저장하지 않는다. 라인은 품목 + kg당 단가만(톤당 = ×1,000 은 표시 시 환산).
--   · 매출 견적(quote, 0052)과 구조가 다르고(총액·수량 없음, 매출 전환 없음) 매출 전용 로직(convert_quote_to_sale·
--     total_krw 목록 표시·매출 이력 기반 문자 가드)이 섞이지 않도록 별도 테이블로 둔다.
--   · 책별 룰: 법인(bk)은 자료거래만(부가세 별도 표기 강제), B계좌(b)는 무자료만 — quote 에는 없던 CHECK 를 여기서는 건다.
--   · status: draft → sent → done(계근·매입 등록 완료) / expired. 매입(purchase) 전환 RPC 는 두지 않는다 —
--     kg 매입은 실중량 필수(chk_kg_unit_actual_required)라 계근 후 매입 폼에서 등록하고 done 으로 표시한다.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE purchase_quote_status AS ENUM ('draft', 'sent', 'done', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- purchase_quote (헤더)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_quote (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book            book_type NOT NULL,
  doc_no          TEXT UNIQUE NOT NULL,            -- 매입견적번호 PQ{YYYYMMDD}-NNN

  partner_id      UUID REFERENCES partner(id),     -- 판매자(거래처) optional — 미등록이면 prospect_name
  prospect_name   TEXT,                            -- 미등록 판매자명(자유 텍스트)
  site_id         UUID REFERENCES site(id),
  site_name       TEXT,                            -- 물건이 있는 현장(철거 현장 등)

  quote_date      DATE NOT NULL,
  valid_until     DATE,

  is_documented   BOOLEAN NOT NULL DEFAULT TRUE,   -- TRUE: 단가는 공급가액(부가세 별도) / FALSE: 무자료(부가세 없음)

  weighing_terms  TEXT,                            -- 계근 조건(예: 당일 공인 계근대 계근표 기준)
  delivery_terms  TEXT,                            -- 운반·상하차 부담
  payment_terms   TEXT,                            -- 결제 조건(예: 계근 당일 송금)
  notes           TEXT,

  status          purchase_quote_status NOT NULL DEFAULT 'draft',
  sent_on         DATE,
  mms_sent_on     DATE,
  done_on         DATE,                            -- 계근·매입 등록 완료 표시일

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES user_profile(user_id),
  updated_by      UUID REFERENCES user_profile(user_id),

  -- 절대 룰 1·2: 법인은 자료거래만, B계좌는 무자료만.
  CONSTRAINT chk_pq_bk_documented CHECK (book <> 'bk' OR is_documented = TRUE),
  CONSTRAINT chk_pq_b_undocumented CHECK (book <> 'b' OR is_documented = FALSE)
);

CREATE INDEX IF NOT EXISTS idx_purchase_quote_book_date
  ON purchase_quote(book, quote_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_quote_partner
  ON purchase_quote(partner_id, quote_date DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_purchase_quote_updated_at ON purchase_quote;
CREATE TRIGGER trg_purchase_quote_updated_at
  BEFORE UPDATE ON purchase_quote
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- purchase_quote_line — 품목 + kg당 단가. 수량·중량·금액 없음(계근 후 확정).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_quote_line (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_quote_id  UUID NOT NULL REFERENCES purchase_quote(id) ON DELETE CASCADE,
  book               book_type NOT NULL,
  sort_order         INT NOT NULL DEFAULT 0,

  item_id            UUID REFERENCES item(id),     -- 품목 마스터와 이름이 일치하면 연결(선택) — 매입 등록 시 참고
  display_name       TEXT NOT NULL,                -- 문서에 찍히는 품목명(예: 중고철근, 고철(생철))
  spec_text          TEXT,                         -- 규격·상태(예: D13~D25 혼합, 절단 1m 이하)
  price_per_kg_krw   NUMERIC(12,2) NOT NULL,       -- 매입 단가(원/kg). 톤당은 ×1,000 환산 표시
  notes              TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ,

  CONSTRAINT chk_pq_line_price_positive CHECK (price_per_kg_krw > 0)
);

CREATE INDEX IF NOT EXISTS idx_purchase_quote_line_quote ON purchase_quote_line(purchase_quote_id);

DROP TRIGGER IF EXISTS trg_purchase_quote_line_updated_at ON purchase_quote_line;
CREATE TRIGGER trg_purchase_quote_line_updated_at
  BEFORE UPDATE ON purchase_quote_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- RLS — quote 패턴(0052/0059): SELECT viewer / INSERT·UPDATE staff / 라인 DELETE staff(라인 교체 RPC 용).
-- 헤더 삭제는 soft(deleted_at).
-- ------------------------------------------------------------
ALTER TABLE purchase_quote ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_quote_line ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_quote_select ON purchase_quote;
DROP POLICY IF EXISTS purchase_quote_insert ON purchase_quote;
DROP POLICY IF EXISTS purchase_quote_update ON purchase_quote;
CREATE POLICY purchase_quote_select ON purchase_quote FOR SELECT USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY purchase_quote_insert ON purchase_quote FOR INSERT WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY purchase_quote_update ON purchase_quote FOR UPDATE USING (current_user_has_book_role(book, 'staff')) WITH CHECK (current_user_has_book_role(book, 'staff'));

DROP POLICY IF EXISTS purchase_quote_line_select ON purchase_quote_line;
DROP POLICY IF EXISTS purchase_quote_line_insert ON purchase_quote_line;
DROP POLICY IF EXISTS purchase_quote_line_update ON purchase_quote_line;
DROP POLICY IF EXISTS purchase_quote_line_delete ON purchase_quote_line;
CREATE POLICY purchase_quote_line_select ON purchase_quote_line FOR SELECT USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY purchase_quote_line_insert ON purchase_quote_line FOR INSERT WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY purchase_quote_line_update ON purchase_quote_line FOR UPDATE USING (current_user_has_book_role(book, 'staff')) WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY purchase_quote_line_delete ON purchase_quote_line FOR DELETE USING (current_user_has_book_role(book, 'staff'));

-- ------------------------------------------------------------
-- 원자적 생성 (헤더 1 + 라인 N) — create_quote_with_lines 미러
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_purchase_quote_with_lines(p_quote jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id   uuid;
  v_book book_type := (p_quote->>'book')::book_type;
  v_line jsonb;
  v_i    int := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '매입견적 품목 라인이 비어 있습니다';
  END IF;

  INSERT INTO purchase_quote (
    book, doc_no, partner_id, prospect_name, site_id, site_name,
    quote_date, valid_until, is_documented,
    weighing_terms, delivery_terms, payment_terms, notes, status
  ) VALUES (
    v_book,
    p_quote->>'doc_no',
    NULLIF(p_quote->>'partner_id','')::uuid,
    NULLIF(p_quote->>'prospect_name',''),
    NULLIF(p_quote->>'site_id','')::uuid,
    NULLIF(p_quote->>'site_name',''),
    (p_quote->>'quote_date')::date,
    NULLIF(p_quote->>'valid_until','')::date,
    COALESCE((p_quote->>'is_documented')::boolean, TRUE),
    NULLIF(p_quote->>'weighing_terms',''),
    NULLIF(p_quote->>'delivery_terms',''),
    NULLIF(p_quote->>'payment_terms',''),
    NULLIF(p_quote->>'notes',''),
    COALESCE((p_quote->>'status')::purchase_quote_status, 'draft')
  )
  RETURNING id INTO v_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO purchase_quote_line (
      purchase_quote_id, book, sort_order, item_id, display_name, spec_text, price_per_kg_krw, notes
    ) VALUES (
      v_id,
      v_book,
      v_i,
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

-- ------------------------------------------------------------
-- 수정 (헤더 UPDATE + 라인 전체 교체) — update_quote_with_lines 미러. status·doc_no·book 보존.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_purchase_quote_with_lines(p_quote_id uuid, p_quote jsonb, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_book book_type;
  v_line jsonb;
  v_i    int := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '매입견적 품목 라인이 비어 있습니다';
  END IF;

  UPDATE purchase_quote SET
    partner_id     = NULLIF(p_quote->>'partner_id','')::uuid,
    prospect_name  = NULLIF(p_quote->>'prospect_name',''),
    site_id        = NULLIF(p_quote->>'site_id','')::uuid,
    site_name      = NULLIF(p_quote->>'site_name',''),
    quote_date     = (p_quote->>'quote_date')::date,
    valid_until    = NULLIF(p_quote->>'valid_until','')::date,
    is_documented  = COALESCE((p_quote->>'is_documented')::boolean, TRUE),
    weighing_terms = NULLIF(p_quote->>'weighing_terms',''),
    delivery_terms = NULLIF(p_quote->>'delivery_terms',''),
    payment_terms  = NULLIF(p_quote->>'payment_terms',''),
    notes          = NULLIF(p_quote->>'notes','')
  WHERE id = p_quote_id AND deleted_at IS NULL
  RETURNING book INTO v_book;
  IF v_book IS NULL THEN
    RAISE EXCEPTION '매입견적을 찾을 수 없습니다';
  END IF;

  DELETE FROM purchase_quote_line WHERE purchase_quote_id = p_quote_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO purchase_quote_line (
      purchase_quote_id, book, sort_order, item_id, display_name, spec_text, price_per_kg_krw, notes
    ) VALUES (
      p_quote_id,
      v_book,
      v_i,
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
