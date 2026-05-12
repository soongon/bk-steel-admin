-- ============================================================
-- 0017_audit.sql
-- 감사 로그 (audit_log) + 트리거 함수 + 전 거래성 테이블에 트리거 부착
-- 참조: docs/시스템_DB_스키마_v1.md §16
-- ============================================================

-- ============================================================
-- audit_log
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  table_name      TEXT NOT NULL,
  row_id          UUID NOT NULL,
  book            book_type,                                  -- 거래성 row만 채움
  action          TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  before          JSONB,
  after           JSONB,
  changed_columns TEXT[],
  actor           UUID,                                       -- auth.uid() (NULL 허용 — 시드/시스템)
  actor_label     TEXT,                                       -- 'system','seed_YYYYMMDD' 등
  ip              INET,
  ua              TEXT,
  sensitive       BOOLEAN NOT NULL DEFAULT FALSE,             -- B계좌 관련은 TRUE
  at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_table_row ON audit_log(table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_audit_book_at   ON audit_log(book, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_sensitive ON audit_log(sensitive, at DESC) WHERE sensitive = TRUE;
CREATE INDEX IF NOT EXISTS idx_audit_actor_at  ON audit_log(actor, at DESC) WHERE actor IS NOT NULL;

-- ============================================================
-- 트리거 함수
-- - auth.uid() NULL이면 app.system_actor_label 세션 변수에서 라벨 가져옴 (시드/시스템)
-- - B 책 row는 sensitive=TRUE
-- ============================================================
CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
DECLARE
  v_book        book_type;
  v_row_id      UUID;
  v_before      JSONB;
  v_after       JSONB;
  v_changed     TEXT[];
  v_actor       UUID;
  v_actor_label TEXT;
BEGIN
  -- actor 파악 (auth context가 없을 수도 — 시드 등)
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF v_actor IS NULL THEN
    v_actor_label := current_setting('app.system_actor_label', TRUE);
    IF v_actor_label IS NULL OR v_actor_label = '' THEN
      v_actor_label := 'system';
    END IF;
  END IF;

  -- INSERT/UPDATE/DELETE 분기
  IF TG_OP = 'INSERT' THEN
    v_after  := to_jsonb(NEW);
    v_row_id := (NEW).id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    v_row_id := (NEW).id;
    SELECT array_agg(key) INTO v_changed
      FROM jsonb_each(v_after)
     WHERE v_before->>key IS DISTINCT FROM v_after->>key;
  ELSE  -- DELETE
    v_before := to_jsonb(OLD);
    v_row_id := (OLD).id;
  END IF;

  -- book 컬럼 추출 (없는 테이블이면 NULL)
  v_book := COALESCE(
    NULLIF(v_after  ->> 'book', '')::book_type,
    NULLIF(v_before ->> 'book', '')::book_type
  );

  INSERT INTO audit_log
    (table_name, row_id, book, action, before, after, changed_columns, actor, actor_label, sensitive)
  VALUES
    (TG_TABLE_NAME, v_row_id, v_book, TG_OP, v_before, v_after, v_changed,
     v_actor, v_actor_label, v_book = 'b');

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_temp;

-- 트리거 함수는 PostgREST RPC로 노출될 필요 없음 → 전역 EXECUTE 회수
REVOKE EXECUTE ON FUNCTION audit_trigger_fn() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION audit_trigger_fn() FROM anon, authenticated;

-- ============================================================
-- 트리거 부착 (모든 거래성 + 핵심 마스터)
-- ============================================================
DROP TRIGGER IF EXISTS trg_audit_purchase           ON purchase;
CREATE TRIGGER trg_audit_purchase           AFTER INSERT OR UPDATE OR DELETE ON purchase           FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_purchase_line      ON purchase_line;
CREATE TRIGGER trg_audit_purchase_line      AFTER INSERT OR UPDATE OR DELETE ON purchase_line      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_sale               ON sale;
CREATE TRIGGER trg_audit_sale               AFTER INSERT OR UPDATE OR DELETE ON sale               FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_sale_line          ON sale_line;
CREATE TRIGGER trg_audit_sale_line          AFTER INSERT OR UPDATE OR DELETE ON sale_line          FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_allocation         ON sale_line_allocation;
CREATE TRIGGER trg_audit_allocation         AFTER INSERT OR UPDATE OR DELETE ON sale_line_allocation FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_book_transfer      ON book_transfer;
CREATE TRIGGER trg_audit_book_transfer      AFTER INSERT OR UPDATE OR DELETE ON book_transfer      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_inventory_adj      ON inventory_adjustment;
CREATE TRIGGER trg_audit_inventory_adj      AFTER INSERT OR UPDATE OR DELETE ON inventory_adjustment FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_consignment_in     ON consignment_in;
CREATE TRIGGER trg_audit_consignment_in     AFTER INSERT OR UPDATE OR DELETE ON consignment_in     FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_bank_account       ON bank_account;
CREATE TRIGGER trg_audit_bank_account       AFTER INSERT OR UPDATE OR DELETE ON bank_account       FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_bank_txn           ON bank_transaction;
CREATE TRIGGER trg_audit_bank_txn           AFTER INSERT OR UPDATE OR DELETE ON bank_transaction   FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_promissory_note    ON promissory_note;
CREATE TRIGGER trg_audit_promissory_note    AFTER INSERT OR UPDATE OR DELETE ON promissory_note    FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_receipt            ON receipt;
CREATE TRIGGER trg_audit_receipt            AFTER INSERT OR UPDATE OR DELETE ON receipt            FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
