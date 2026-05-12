-- ============================================================
-- 0004_masters_shared.sql
-- 공유 마스터: partner, market_item, rebar_spec/grade, item, warehouse, warehouse_zone
-- 참조: docs/시스템_DB_스키마_v1.md §3
-- ============================================================

-- ============================================================
-- 거래처 (partner)
-- ============================================================
CREATE TABLE IF NOT EXISTS partner (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,                          -- 표준 거래처명 (매출/매입 정합성 기준)
  business_no     TEXT,
  representative  TEXT,
  phone           TEXT,
  fax             TEXT,
  address         TEXT,
  industry        TEXT,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES user_profile(user_id),
  updated_by      UUID REFERENCES user_profile(user_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_active ON partner(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_partner_name_trgm ON partner USING gin (name gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_partner_updated_at ON partner;
CREATE TRIGGER trg_partner_updated_at
  BEFORE UPDATE ON partner
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 거래처 별칭 (표기 변동 흡수)
-- ============================================================
CREATE TABLE IF NOT EXISTS partner_alias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  UUID NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partner_alias_partner ON partner_alias(partner_id);

-- ============================================================
-- 거래처별·책별 신용한도 (여신)
-- ============================================================
CREATE TABLE IF NOT EXISTS partner_credit_limit (
  partner_id        UUID NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  book              book_type NOT NULL,
  credit_limit_krw  NUMERIC(15,0) NOT NULL DEFAULT 0,
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        UUID REFERENCES user_profile(user_id),
  PRIMARY KEY (partner_id, book)
);

DROP TRIGGER IF EXISTS trg_partner_credit_updated_at ON partner_credit_limit;
CREATE TRIGGER trg_partner_credit_updated_at
  BEFORE UPDATE ON partner_credit_limit
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 시세 분류 마스터 (market_item)
-- ============================================================
CREATE TABLE IF NOT EXISTS market_item (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,
  label_ko      TEXT NOT NULL,
  category      TEXT NOT NULL,                  -- 'rebar','hbeam','pipe','scrap',...
  default_unit  acquired_unit NOT NULL DEFAULT 'kg',
  display_order INT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 철근 마스터 (rebar_spec / rebar_grade)
-- 시드는 supabase/seed/0001_rebar_spec.sql, 0002_rebar_grade.sql 참조
-- ============================================================
CREATE TABLE IF NOT EXISTS rebar_spec (
  spec_code              TEXT PRIMARY KEY,                -- 'D10','D13',...
  nominal_diameter_mm    NUMERIC(5,2) NOT NULL,
  nominal_area_mm2       NUMERIC(8,2) NOT NULL,
  unit_weight_kg_per_m   NUMERIC(6,3) NOT NULL,
  standard_length_m      INT NOT NULL DEFAULT 8,
  bars_per_bundle        INT,
  bundle_weight_kg       NUMERIC(8,2),
  display_order          INT,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rebar_grade (
  grade_code         TEXT PRIMARY KEY,                    -- 'SD300','SD400',...
  yield_strength_mpa INT NOT NULL,
  category           TEXT NOT NULL,                       -- '일반용','용접용','특수내진용'
  display_order      INT
);

-- ============================================================
-- 환산 함수 (가닥↔kg↔톤↔번들)
-- 참조: docs/철근_제품마스터.md §4
-- ============================================================
CREATE OR REPLACE FUNCTION rebar_weight_kg(
  p_spec TEXT,
  p_bars INT,
  p_length_m NUMERIC DEFAULT NULL
) RETURNS NUMERIC AS $$
  SELECT unit_weight_kg_per_m * COALESCE(p_length_m, standard_length_m) * p_bars
    FROM rebar_spec WHERE spec_code = p_spec;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION rebar_bars_for_tons(
  p_spec TEXT,
  p_tons NUMERIC,
  p_length_m NUMERIC DEFAULT NULL
) RETURNS INT AS $$
  SELECT CEIL((p_tons * 1000) / (unit_weight_kg_per_m * COALESCE(p_length_m, standard_length_m)))::INT
    FROM rebar_spec WHERE spec_code = p_spec;
$$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION rebar_weight_by_bundles(
  p_spec TEXT,
  p_bundles INT
) RETURNS NUMERIC AS $$
  SELECT bundle_weight_kg * p_bundles
    FROM rebar_spec WHERE spec_code = p_spec;
$$ LANGUAGE SQL IMMUTABLE;

-- ============================================================
-- 품목 마스터 (item)
-- ============================================================
CREATE TABLE IF NOT EXISTS item (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT UNIQUE NOT NULL,                -- 'REBAR_D13_SD400_8M'
  name                TEXT NOT NULL,                       -- '철근 D13 SD400 8M'
  category            TEXT NOT NULL,                       -- 'rebar','hbeam','pipe','scrap','etc'
  market_item_id      UUID REFERENCES market_item(id),

  rebar_spec_code     TEXT REFERENCES rebar_spec(spec_code),
  rebar_grade_code    TEXT REFERENCES rebar_grade(grade_code),
  length_m            NUMERIC(5,2),

  spec_text           TEXT,                                -- 자유 텍스트 규격
  weight_per_unit_kg  NUMERIC(10,3),                       -- 표준 단위중량 (kg/EA, kg/m 등)

  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT chk_rebar_consistency CHECK (
    (category = 'rebar' AND rebar_spec_code IS NOT NULL)
    OR (category <> 'rebar' AND rebar_spec_code IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_item_category ON item(category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_item_market ON item(market_item_id);

DROP TRIGGER IF EXISTS trg_item_updated_at ON item;
CREATE TRIGGER trg_item_updated_at
  BEFORE UPDATE ON item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 창고 / 야적장 (warehouse + warehouse_zone)
-- ============================================================
CREATE TABLE IF NOT EXISTS warehouse (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  address     TEXT,
  kind        warehouse_kind NOT NULL DEFAULT 'owned',
  partner_id  UUID REFERENCES partner(id),
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_partner_warehouse CHECK (
    (kind = 'partner' AND partner_id IS NOT NULL)
    OR (kind = 'owned' AND partner_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS warehouse_zone (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id    UUID NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE,
  zone_code       TEXT NOT NULL,                  -- 'A','B-1','뒷마당' 등
  preferred_book  book_type,                      -- 통상 이 zone에 두는 책 (강제 아님)
  display_order   INT,
  notes           TEXT,
  UNIQUE (warehouse_id, zone_code)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_zone_wh ON warehouse_zone(warehouse_id);
