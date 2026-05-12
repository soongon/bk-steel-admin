-- ============================================================
-- 0008_purchase.sql
-- 매입 헤더 + 매입 라인 (재고 ledger의 핵심 — purchase_line이 piece/lot 역할)
-- 참조: docs/시스템_DB_스키마_v1.md §5
-- ============================================================

-- ============================================================
-- purchase (헤더)
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book                book_type NOT NULL,
  doc_no              TEXT UNIQUE NOT NULL,
  partner_id          UUID NOT NULL REFERENCES partner(id),

  purchase_subtype    purchase_subtype NOT NULL DEFAULT 'external',
  transfer_id         UUID REFERENCES book_transfer(id),  -- 단방향 FK

  ordered_on          DATE NOT NULL,
  delivered_on        DATE,

  is_documented       BOOLEAN NOT NULL,
  tax_doc_type        tax_doc_type NOT NULL DEFAULT 'tax_invoice_electronic',
  tax_doc_no          TEXT,
  vat_type            vat_type NOT NULL DEFAULT 'standard_10',
  vat_rate            NUMERIC(5,2) NOT NULL DEFAULT 10.00,

  subtotal_krw        NUMERIC(15,0) NOT NULL DEFAULT 0,
  vat_krw             NUMERIC(15,0) NOT NULL DEFAULT 0,
  total_krw           NUMERIC(15,0) NOT NULL DEFAULT 0,

  payment_due_on      DATE,
  paid_on             DATE,
  pay_bank_account_id UUID REFERENCES bank_account(id),

  status              purchase_status NOT NULL DEFAULT 'ordered',
  notes               TEXT,
  attachments         JSONB,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES user_profile(user_id),
  updated_by          UUID REFERENCES user_profile(user_id),

  -- BK는 100% 자료거래
  CONSTRAINT chk_bk_documented CHECK (
    book <> 'bk' OR is_documented = TRUE
  ),
  -- B는 무자료 + tax_doc_type='none'만
  CONSTRAINT chk_b_undocumented CHECK (
    book <> 'b' OR (is_documented = FALSE AND tax_doc_type = 'none')
  ),
  -- subtype과 transfer_id 정합성
  CONSTRAINT chk_transfer_id_when_subtype CHECK (
    (purchase_subtype = 'external' AND transfer_id IS NULL)
    OR (purchase_subtype <> 'external' AND transfer_id IS NOT NULL)
  ),
  -- vat_type과 vat_rate 정합성
  CONSTRAINT chk_vat_type_rate CHECK (
    (vat_type = 'standard_10' AND vat_rate = 10.00)
    OR (vat_type IN ('zero_rated','exempt','non_taxable') AND vat_rate = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_purchase_book_date
  ON purchase(book, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_partner_date
  ON purchase(partner_id, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_transfer
  ON purchase(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_unpaid
  ON purchase(book, payment_due_on)
  WHERE deleted_at IS NULL AND paid_on IS NULL;

DROP TRIGGER IF EXISTS trg_purchase_updated_at ON purchase;
CREATE TRIGGER trg_purchase_updated_at
  BEFORE UPDATE ON purchase
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- purchase_line (라인 = piece/lot 역할)
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_line (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id              UUID NOT NULL REFERENCES purchase(id) ON DELETE CASCADE,
  book                     book_type NOT NULL,
  warehouse_id             UUID NOT NULL REFERENCES warehouse(id),
  warehouse_zone_id        UUID REFERENCES warehouse_zone(id),
  item_id                  UUID NOT NULL REFERENCES item(id),

  acquired_unit            acquired_unit NOT NULL,
  acquired_qty             NUMERIC(15,3) NOT NULL,
  unit_price_krw           NUMERIC(15,2) NOT NULL,

  bars_count               INT,
  length_mm                INT,
  grade                    TEXT,

  theoretical_weight_kg    NUMERIC(12,3),
  actual_weight_kg         NUMERIC(12,3),
  invoiced_weight_kg       NUMERIC(12,3),
  price_basis              price_basis NOT NULL DEFAULT 'theoretical',

  line_subtotal_krw        NUMERIC(15,0) NOT NULL,
  status                   purchase_status NOT NULL DEFAULT 'in_stock',

  parent_purchase_line_id  UUID REFERENCES purchase_line(id),  -- cut/split의 부모
  created_by_adjustment_id UUID,                               -- inventory_adjustment.id (FK는 0010 ALTER로 추가)

  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES user_profile(user_id),
  updated_by               UUID REFERENCES user_profile(user_id),

  -- kg 단위 매입은 실중량 필수 (중고철근 등)
  CONSTRAINT chk_kg_unit_actual_required CHECK (
    acquired_unit <> 'kg' OR actual_weight_kg IS NOT NULL
  ),
  -- 가닥 단위(ea/piece/bundle) 매입은 bars_count 필수
  CONSTRAINT chk_bars_count_required CHECK (
    acquired_unit NOT IN ('ea','piece','bundle') OR bars_count IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_purchase_line_book_item
  ON purchase_line(book, item_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_line_warehouse
  ON purchase_line(warehouse_id, warehouse_zone_id);
CREATE INDEX IF NOT EXISTS idx_purchase_line_status
  ON purchase_line(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_line_parent
  ON purchase_line(parent_purchase_line_id) WHERE parent_purchase_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_line_purchase
  ON purchase_line(purchase_id);

DROP TRIGGER IF EXISTS trg_purchase_line_updated_at ON purchase_line;
CREATE TRIGGER trg_purchase_line_updated_at
  BEFORE UPDATE ON purchase_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
