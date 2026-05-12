-- ============================================================
-- 0010_inventory_adjustment.sql
-- 재고 조정 — transform(cut/split/merge)과 delta(stocktake/loss/scrap/return) 분리
-- 참조: docs/시스템_DB_스키마_v1.md §8
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_adjustment (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book                     book_type NOT NULL,
  kind                     inventory_adjustment_kind NOT NULL,
  reason                   inventory_adjustment_reason NOT NULL,
  adj_on                   DATE NOT NULL,

  -- transform 계열: 부모 라인
  source_purchase_line_id  UUID REFERENCES purchase_line(id),

  -- delta 계열: 단순 증감 (양/음수)
  delta_qty                NUMERIC(15,3),
  delta_weight_kg          NUMERIC(12,3),

  notes                    TEXT,
  attachments              JSONB,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES user_profile(user_id),

  -- kind ↔ reason 정합성
  CONSTRAINT chk_kind_reason CHECK (
    (kind = 'transform' AND reason IN ('cut','split','merge'))
    OR
    (kind = 'delta' AND reason IN ('stocktake','loss','scrap','return_in','return_out'))
  ),
  -- transform이면 source_purchase_line_id 필수
  CONSTRAINT chk_transform_source CHECK (
    kind <> 'transform' OR source_purchase_line_id IS NOT NULL
  ),
  -- delta면 delta_weight_kg 필수
  CONSTRAINT chk_delta_amount CHECK (
    kind <> 'delta' OR delta_weight_kg IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_inv_adj_book_date
  ON inventory_adjustment(book, adj_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inv_adj_source
  ON inventory_adjustment(source_purchase_line_id)
  WHERE source_purchase_line_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_inv_adj_updated_at ON inventory_adjustment;
CREATE TRIGGER trg_inv_adj_updated_at
  BEFORE UPDATE ON inventory_adjustment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- purchase_line.created_by_adjustment_id 의 FK 지연 추가
-- (0008에서 컬럼만 두고 FK는 inventory_adjustment 생성 후 부여)
-- ============================================================
ALTER TABLE purchase_line
  DROP CONSTRAINT IF EXISTS fk_purchase_line_created_by_adjustment;
ALTER TABLE purchase_line
  ADD CONSTRAINT fk_purchase_line_created_by_adjustment
  FOREIGN KEY (created_by_adjustment_id) REFERENCES inventory_adjustment(id);
