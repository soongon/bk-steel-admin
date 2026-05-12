-- ============================================================
-- 0005_masters_book.sql
-- 책 종속 마스터: bank_account
-- 참조: docs/시스템_DB_스키마_v1.md §4
-- ============================================================

CREATE TABLE IF NOT EXISTS bank_account (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book            book_type NOT NULL,
  code            TEXT NOT NULL,                  -- '법인A','사업자A','B계좌'
  bank_name       TEXT NOT NULL,
  account_number  TEXT,                            -- B계좌는 nullable
  account_holder  TEXT,
  kind            bank_account_kind NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  UNIQUE (book, code),

  -- 책 ↔ 통장 종류 정합성
  CONSTRAINT chk_bank_kind_book CHECK (
    (book = 'bk' AND kind = 'corporate')
    OR (book = 'sl' AND kind = 'personal')
    OR (book = 'b'  AND kind = 'b_hidden')
  )
);

CREATE INDEX IF NOT EXISTS idx_bank_account_book ON bank_account(book) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_bank_account_updated_at ON bank_account;
CREATE TRIGGER trg_bank_account_updated_at
  BEFORE UPDATE ON bank_account
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
