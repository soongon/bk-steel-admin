-- ============================================================
-- 0009_sale.sql
-- 매출 헤더 + 라인 + 매출↔매입 매칭(sale_line_allocation, 개별법 FIFO)
-- 참조: docs/시스템_DB_스키마_v1.md §6
-- ============================================================

-- ============================================================
-- sale (헤더)
-- ============================================================
CREATE TABLE IF NOT EXISTS sale (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book                      book_type NOT NULL,
  doc_no                    TEXT UNIQUE NOT NULL,
  partner_id                UUID NOT NULL REFERENCES partner(id),
  site_name                 TEXT,                          -- 현장명 (거래처와 분리)

  sale_subtype              sale_subtype NOT NULL DEFAULT 'external',
  transfer_id               UUID REFERENCES book_transfer(id),

  ordered_on                DATE NOT NULL,
  delivered_on              DATE,

  is_documented             BOOLEAN NOT NULL,
  tax_doc_type              tax_doc_type NOT NULL DEFAULT 'tax_invoice_electronic',
  tax_doc_no                TEXT,
  vat_type                  vat_type NOT NULL DEFAULT 'standard_10',
  vat_rate                  NUMERIC(5,2) NOT NULL DEFAULT 10.00,

  subtotal_krw              NUMERIC(15,0) NOT NULL DEFAULT 0,
  vat_krw                   NUMERIC(15,0) NOT NULL DEFAULT 0,
  total_krw                 NUMERIC(15,0) NOT NULL DEFAULT 0,

  payment_due_on            DATE,
  settled_on                DATE,
  receive_bank_account_id   UUID REFERENCES bank_account(id),

  status                    sale_status NOT NULL DEFAULT 'reserved',
  notes                     TEXT,
  attachments               JSONB,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ,
  created_by                UUID REFERENCES user_profile(user_id),
  updated_by                UUID REFERENCES user_profile(user_id),

  CONSTRAINT chk_bk_documented_sale CHECK (
    book <> 'bk' OR is_documented = TRUE
  ),
  CONSTRAINT chk_b_undocumented_sale CHECK (
    book <> 'b' OR (is_documented = FALSE AND tax_doc_type = 'none')
  ),
  CONSTRAINT chk_sale_transfer_id CHECK (
    (sale_subtype = 'external' AND transfer_id IS NULL)
    OR (sale_subtype <> 'external' AND transfer_id IS NOT NULL)
  ),
  CONSTRAINT chk_sale_vat_type_rate CHECK (
    (vat_type = 'standard_10' AND vat_rate = 10.00)
    OR (vat_type IN ('zero_rated','exempt','non_taxable') AND vat_rate = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_sale_book_date
  ON sale(book, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sale_partner_date
  ON sale(partner_id, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sale_transfer
  ON sale(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_unsettled
  ON sale(book, payment_due_on)
  WHERE deleted_at IS NULL AND settled_on IS NULL AND status NOT IN ('cancelled');

DROP TRIGGER IF EXISTS trg_sale_updated_at ON sale;
CREATE TRIGGER trg_sale_updated_at
  BEFORE UPDATE ON sale
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- sale_line
-- ============================================================
CREATE TABLE IF NOT EXISTS sale_line (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id                UUID NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
  book                   book_type NOT NULL,
  item_id                UUID NOT NULL REFERENCES item(id),

  unit                   acquired_unit NOT NULL,
  qty                    NUMERIC(15,3) NOT NULL,
  unit_price_krw         NUMERIC(15,2) NOT NULL,
  weight_kg              NUMERIC(12,3),

  theoretical_weight_kg  NUMERIC(12,3),
  actual_weight_kg       NUMERIC(12,3),
  invoiced_weight_kg     NUMERIC(12,3),
  price_basis            price_basis NOT NULL DEFAULT 'theoretical',

  line_subtotal_krw      NUMERIC(15,0) NOT NULL,
  status                 sale_status NOT NULL DEFAULT 'reserved',

  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sale_line_book_item
  ON sale_line(book, item_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sale_line_sale
  ON sale_line(sale_id);

DROP TRIGGER IF EXISTS trg_sale_line_updated_at ON sale_line;
CREATE TRIGGER trg_sale_line_updated_at
  BEFORE UPDATE ON sale_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- sale_line_allocation (개별법 매칭, 무게 기준, FIFO 기본)
-- 룰: 매입·매출 단위가 달라도 allocated_weight_kg로 정합
-- ============================================================
CREATE TABLE IF NOT EXISTS sale_line_allocation (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_line_id          UUID NOT NULL REFERENCES sale_line(id) ON DELETE CASCADE,
  purchase_line_id      UUID NOT NULL REFERENCES purchase_line(id),

  allocated_qty         NUMERIC(15,3) NOT NULL,            -- 매출 단위 기준 표시
  allocated_weight_kg   NUMERIC(12,3) NOT NULL,            -- 매칭의 정합 기준
  cost_krw              NUMERIC(15,0) NOT NULL,            -- 매출원가 = 매입단가 환산 × 차감무게

  allocated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                 TEXT,

  CONSTRAINT chk_alloc_positive CHECK (allocated_weight_kg > 0)
);

CREATE INDEX IF NOT EXISTS idx_alloc_sale
  ON sale_line_allocation(sale_line_id);
CREATE INDEX IF NOT EXISTS idx_alloc_purchase
  ON sale_line_allocation(purchase_line_id);
