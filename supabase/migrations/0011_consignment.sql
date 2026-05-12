-- ============================================================
-- 0011_consignment.sql
-- 위탁 입고 (타사 재고가 우리 야적장에 있는 경우)
-- 우리 ledger 외부 — book 컬럼 없음. RLS는 0019에서 owner/manager 전용으로 설정
-- 참조: docs/시스템_DB_스키마_v1.md §9
-- ============================================================

CREATE TABLE IF NOT EXISTS consignment_in (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          UUID NOT NULL REFERENCES partner(id),
  warehouse_id        UUID NOT NULL REFERENCES warehouse(id),
  warehouse_zone_id   UUID REFERENCES warehouse_zone(id),
  item_id             UUID REFERENCES item(id),
  spec_text           TEXT,                                -- 비표준 품목일 때 자유 텍스트

  qty                 NUMERIC(15,3) NOT NULL,
  unit                acquired_unit NOT NULL,
  weight_kg           NUMERIC(12,3),

  in_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  out_at              TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'in' CHECK (status IN ('in','out')),
  notes               TEXT,
  attachments         JSONB,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES user_profile(user_id)
);

CREATE INDEX IF NOT EXISTS idx_consignment_in_warehouse
  ON consignment_in(warehouse_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_consignment_in_partner
  ON consignment_in(partner_id);

DROP TRIGGER IF EXISTS trg_consignment_in_updated_at ON consignment_in;
CREATE TRIGGER trg_consignment_in_updated_at
  BEFORE UPDATE ON consignment_in
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
