-- ============================================================
-- 0007_book_transfer.sql
-- 책 간 이관 헤더 (BK↔SL: inter_book_transfer / SL↔B: internal_reclass)
-- 짝 매출/매입은 sale.transfer_id / purchase.transfer_id 단방향 FK로 연결 (0008/0009)
-- 참조: docs/시스템_DB_스키마_v1.md §7
-- ============================================================

CREATE TABLE IF NOT EXISTS book_transfer (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_type            book_transfer_type NOT NULL,
  source_book              book_type NOT NULL,
  dest_book                book_type NOT NULL,
  transferred_on           DATE NOT NULL,

  -- 시가 근거 (BK↔SL은 NOT NULL 둘 중 하나 필수, SL↔B는 선택)
  source_price_history_id  UUID REFERENCES price_history(id),
  source_doc_url           TEXT,
  rationale_notes          TEXT,

  total_weight_kg          NUMERIC(15,3) NOT NULL DEFAULT 0,
  total_value_krw          NUMERIC(15,0) NOT NULL DEFAULT 0,

  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES user_profile(user_id),
  updated_by               UUID REFERENCES user_profile(user_id),

  -- 허용 매트릭스: BK↔SL은 inter_book_transfer, SL↔B는 internal_reclass만
  CONSTRAINT chk_transfer_pairs CHECK (
    (transfer_type = 'inter_book_transfer'
       AND ((source_book = 'bk' AND dest_book = 'sl')
         OR (source_book = 'sl' AND dest_book = 'bk')))
    OR
    (transfer_type = 'internal_reclass'
       AND ((source_book = 'sl' AND dest_book = 'b')
         OR (source_book = 'b'  AND dest_book = 'sl')))
  ),

  -- BK↔SL 이관은 시가 근거 필수 (price_history 참조 또는 외부 문서)
  CONSTRAINT chk_inter_book_rationale CHECK (
    transfer_type <> 'inter_book_transfer'
    OR source_price_history_id IS NOT NULL
    OR source_doc_url IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_transfer_books
  ON book_transfer(source_book, dest_book, transferred_on DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transfer_type_date
  ON book_transfer(transfer_type, transferred_on DESC);

DROP TRIGGER IF EXISTS trg_book_transfer_updated_at ON book_transfer;
CREATE TRIGGER trg_book_transfer_updated_at
  BEFORE UPDATE ON book_transfer
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
