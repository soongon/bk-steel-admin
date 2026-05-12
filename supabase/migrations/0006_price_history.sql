-- ============================================================
-- 0006_price_history.sql
-- 시세 이력 + 큐레이션
-- 매입가 자동 누적 트리거는 0015에서 purchase_line 정의 후 활성화
-- 참조: docs/시스템_DB_스키마_v1.md §14
-- ============================================================

CREATE TABLE IF NOT EXISTS price_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_item_id  UUID NOT NULL REFERENCES market_item(id),
  recorded_on     DATE NOT NULL,
  price_per_unit  NUMERIC(15,2) NOT NULL,
  unit            acquired_unit NOT NULL,
  price_type      price_type NOT NULL DEFAULT 'spot',
  source          price_source NOT NULL,
  source_label    TEXT,
  source_url      TEXT,
  recorded_by     UUID REFERENCES user_profile(user_id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (market_item_id, recorded_on, source, price_type)
);

CREATE INDEX IF NOT EXISTS idx_price_history_item_date
  ON price_history(market_item_id, recorded_on DESC);

-- ============================================================
-- 큐레이션 (오늘의 시세 페이지에 노출할 품목군)
-- ============================================================
CREATE TABLE IF NOT EXISTS price_curation (
  market_item_id  UUID PRIMARY KEY REFERENCES market_item(id),
  display_order   INT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_price_curation_updated_at ON price_curation;
CREATE TRIGGER trg_price_curation_updated_at
  BEFORE UPDATE ON price_curation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
