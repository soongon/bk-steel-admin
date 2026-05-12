-- ============================================================
-- 0013_promissory_note.sql
-- 어음 (수취/발행) — 만기·결제 추적
-- 참조: docs/시스템_DB_스키마_v1.md §11.2
-- ============================================================

CREATE TABLE IF NOT EXISTS promissory_note (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book          book_type NOT NULL,
  direction     promissory_note_direction NOT NULL,  -- 'received' | 'issued'
  partner_id    UUID REFERENCES partner(id),

  issue_on      DATE NOT NULL,
  maturity_on   DATE NOT NULL,
  amount_krw    NUMERIC(15,0) NOT NULL,
  note_no       TEXT,

  sale_id       UUID REFERENCES sale(id),       -- 수취 어음일 때
  purchase_id   UUID REFERENCES purchase(id),   -- 발행 어음일 때

  status        promissory_note_status NOT NULL DEFAULT 'open',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_note_maturity
  ON promissory_note(maturity_on, status)
  WHERE deleted_at IS NULL AND status = 'open';
CREATE INDEX IF NOT EXISTS idx_note_book_direction
  ON promissory_note(book, direction, maturity_on);
CREATE INDEX IF NOT EXISTS idx_note_partner
  ON promissory_note(partner_id) WHERE partner_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_promissory_note_updated_at ON promissory_note;
CREATE TRIGGER trg_promissory_note_updated_at
  BEFORE UPDATE ON promissory_note
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
