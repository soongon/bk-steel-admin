-- ============================================================
-- 0052_quote.sql
-- 견적서 — 헤더(quote) + 라인(quote_line). sale 미러이되 견적 특성 반영:
--   · partner_id nullable(거래처 optional) + prospect_name(잠재 고객명)
--   · quote_date / valid_until(유효기간), delivery_terms / payment_terms(견적 조건)
--   · status: draft → sent → won → expired (sale_status 와 별개)
-- 출고/매칭(allocation)·납품·수금은 없음(견적은 수주 전 단계).
-- ============================================================

DO $$ BEGIN
  CREATE TYPE quote_status AS ENUM ('draft', 'sent', 'won', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- quote (헤더)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quote (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book            book_type NOT NULL,
  doc_no          TEXT UNIQUE NOT NULL,            -- 견적번호

  partner_id      UUID REFERENCES partner(id),     -- 거래처 optional(잠재 고객은 prospect_name)
  prospect_name   TEXT,                            -- 거래처 미등록 시 잠재 고객명(자유 텍스트)
  site_id         UUID REFERENCES site(id),
  site_name       TEXT,

  quote_date      DATE NOT NULL,                   -- 견적일
  valid_until     DATE,                            -- 유효기간

  is_documented   BOOLEAN NOT NULL DEFAULT TRUE,   -- 부가세 표시 여부(무자료 견적 가능)
  vat_type        vat_type NOT NULL DEFAULT 'standard_10',
  vat_rate        NUMERIC(5,2) NOT NULL DEFAULT 10.00,

  subtotal_krw    NUMERIC(15,0) NOT NULL DEFAULT 0,
  vat_krw         NUMERIC(15,0) NOT NULL DEFAULT 0,
  total_krw       NUMERIC(15,0) NOT NULL DEFAULT 0,

  status          quote_status NOT NULL DEFAULT 'draft',
  sent_on         DATE,                            -- 발송일
  mms_sent_on     DATE,                            -- 문자(MMS) 전송일
  delivery_terms  TEXT,                            -- 납품조건
  payment_terms   TEXT,                            -- 결제조건
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES user_profile(user_id),
  updated_by      UUID REFERENCES user_profile(user_id),

  CONSTRAINT chk_quote_vat_type_rate CHECK (
    (vat_type = 'standard_10' AND vat_rate = 10.00)
    OR (vat_type IN ('zero_rated','exempt','non_taxable') AND vat_rate = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_quote_book_date
  ON quote(book, quote_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quote_partner
  ON quote(partner_id, quote_date DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_quote_updated_at ON quote;
CREATE TRIGGER trg_quote_updated_at
  BEFORE UPDATE ON quote
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- quote_line
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quote_line (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id               UUID NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  book                   book_type NOT NULL,
  item_id                UUID NOT NULL REFERENCES item(id),

  unit                   acquired_unit NOT NULL,
  qty                    NUMERIC(15,3) NOT NULL,
  unit_price_krw         NUMERIC(15,2) NOT NULL,
  weight_kg              NUMERIC(12,3),
  theoretical_weight_kg  NUMERIC(12,3),
  price_basis            price_basis NOT NULL DEFAULT 'theoretical',
  line_subtotal_krw      NUMERIC(15,0) NOT NULL,

  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_line_quote ON quote_line(quote_id);

DROP TRIGGER IF EXISTS trg_quote_line_updated_at ON quote_line;
CREATE TRIGGER trg_quote_line_updated_at
  BEFORE UPDATE ON quote_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- RLS — sale 패턴(0019): SELECT viewer / 변경 staff. 삭제는 soft(deleted_at update).
-- ------------------------------------------------------------
ALTER TABLE quote ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_select ON quote;
DROP POLICY IF EXISTS quote_insert ON quote;
DROP POLICY IF EXISTS quote_update ON quote;
CREATE POLICY quote_select ON quote FOR SELECT USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY quote_insert ON quote FOR INSERT WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY quote_update ON quote FOR UPDATE USING (current_user_has_book_role(book, 'staff')) WITH CHECK (current_user_has_book_role(book, 'staff'));

DROP POLICY IF EXISTS quote_line_select ON quote_line;
DROP POLICY IF EXISTS quote_line_insert ON quote_line;
DROP POLICY IF EXISTS quote_line_update ON quote_line;
CREATE POLICY quote_line_select ON quote_line FOR SELECT USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY quote_line_insert ON quote_line FOR INSERT WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY quote_line_update ON quote_line FOR UPDATE USING (current_user_has_book_role(book, 'staff')) WITH CHECK (current_user_has_book_role(book, 'staff'));

-- ------------------------------------------------------------
-- 원자적 견적 생성 (헤더 1 + 라인 N) — create_sale_with_lines(0046) 미러
-- ------------------------------------------------------------
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
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw
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
      (v_line->>'line_subtotal_krw')::numeric
    );
  END LOOP;

  RETURN v_quote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_quote_with_lines(jsonb, jsonb) TO authenticated;
