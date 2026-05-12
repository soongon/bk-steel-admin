-- ============================================================
-- 0014_receipt.sql
-- 영수증 / 일반비용 (식대·연료비·자재·접대비·급여·임차료 등)
-- 참조: docs/시스템_DB_스키마_v1.md §13
-- ============================================================

CREATE TABLE IF NOT EXISTS receipt (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book                book_type NOT NULL,
  receipt_on          DATE NOT NULL,
  category            TEXT NOT NULL,
  partner_id          UUID REFERENCES partner(id),

  amount_krw          NUMERIC(15,0) NOT NULL,
  vat_included        BOOLEAN NOT NULL DEFAULT TRUE,
  tax_doc_type        tax_doc_type NOT NULL DEFAULT 'simple_receipt',
  tax_doc_no          TEXT,

  attachments         JSONB,
  notes               TEXT,

  pay_bank_account_id UUID REFERENCES bank_account(id),
  pay_method          TEXT,                                  -- 'card','cash','bank_transfer'

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES user_profile(user_id),

  -- BK는 정식 자료만 (간이영수증·무자료 차단)
  CONSTRAINT chk_bk_receipt_documented CHECK (
    book <> 'bk'
    OR tax_doc_type IN ('tax_invoice_electronic','tax_invoice_paper','invoice','cash_receipt')
  ),
  -- B는 무자료
  CONSTRAINT chk_b_receipt_undocumented CHECK (
    book <> 'b' OR tax_doc_type = 'none'
  )
);

CREATE INDEX IF NOT EXISTS idx_receipt_book_date
  ON receipt(book, receipt_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_receipt_category
  ON receipt(category, book, receipt_on DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_partner
  ON receipt(partner_id) WHERE partner_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_receipt_updated_at ON receipt;
CREATE TRIGGER trg_receipt_updated_at
  BEFORE UPDATE ON receipt
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- bank_transaction.receipt_id FK 지연 추가
-- (0012에서 컬럼만 두고 FK는 receipt 생성 후 부여)
-- ============================================================
ALTER TABLE bank_transaction
  DROP CONSTRAINT IF EXISTS fk_bank_txn_receipt;
ALTER TABLE bank_transaction
  ADD CONSTRAINT fk_bank_txn_receipt
  FOREIGN KEY (receipt_id) REFERENCES receipt(id);

CREATE INDEX IF NOT EXISTS idx_txn_receipt
  ON bank_transaction(receipt_id) WHERE receipt_id IS NOT NULL;
