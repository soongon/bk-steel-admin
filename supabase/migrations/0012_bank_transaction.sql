-- ============================================================
-- 0012_bank_transaction.sql
-- 통장 입출금. 매출 수금·매입 결제·영수증·기타 카테고리와 연결
-- 참조: docs/시스템_DB_스키마_v1.md §10
-- ============================================================

CREATE TABLE IF NOT EXISTS bank_transaction (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id     UUID NOT NULL REFERENCES bank_account(id),
  book                book_type NOT NULL,                     -- bank_account.book과 동일 (denormalized)
  txn_on              DATE NOT NULL,

  amount_krw          NUMERIC(15,0) NOT NULL,                  -- 양수: 입금, 음수: 출금
  balance_after_krw   NUMERIC(15,0),                           -- 거래 후 잔액 (스냅샷)

  counterparty        TEXT,                                    -- 상대방 (자유텍스트)
  partner_id          UUID REFERENCES partner(id),

  -- 연결 (정확히 하나만 채워지는 것이 자연 — 강제 X, application 룰)
  sale_id             UUID REFERENCES sale(id),                -- 매출 수금
  purchase_id         UUID REFERENCES purchase(id),            -- 매입 결제
  receipt_id          UUID,                                    -- 영수증 (FK는 receipt 생성 후 0014에서 ALTER)
  category            TEXT,                                    -- 미연결 거래 카테고리

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES user_profile(user_id)
);

CREATE INDEX IF NOT EXISTS idx_txn_account_date
  ON bank_transaction(bank_account_id, txn_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_txn_book_date
  ON bank_transaction(book, txn_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_txn_sale
  ON bank_transaction(sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txn_purchase
  ON bank_transaction(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txn_partner
  ON bank_transaction(partner_id) WHERE partner_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_bank_txn_updated_at ON bank_transaction;
CREATE TRIGGER trg_bank_txn_updated_at
  BEFORE UPDATE ON bank_transaction
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
