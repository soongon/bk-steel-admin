-- ============================================================
-- 0027_audit_sensitive_null_safe.sql
-- audit_trigger_fn 의 sensitive 계산을 NULL-safe 로 수정.
--
-- 문제: book 컬럼이 없는 테이블(sale_line_allocation 등)에서
--   v_book = NULL, NULL = 'b' → NULL → audit_log.sensitive NOT NULL 위반
--   → 트리거 throw → 원본 INSERT 롤백
--
-- 영향받은 테이블 예: sale_line_allocation (allocation insert가 silent fail로 보였음)
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
  ELSE
    v_before := to_jsonb(OLD);
    v_row_id := (OLD).id;
  END IF;

  v_book := COALESCE(
    NULLIF(v_after  ->> 'book', '')::book_type,
    NULLIF(v_before ->> 'book', '')::book_type
  );

  INSERT INTO audit_log
    (table_name, row_id, book, action, before, after, changed_columns, actor, actor_label, sensitive)
  VALUES
    (TG_TABLE_NAME, v_row_id, v_book, TG_OP, v_before, v_after, v_changed,
     v_actor, v_actor_label, COALESCE(v_book = 'b', FALSE));  -- ← 핵심 수정: NULL → FALSE

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_temp;
