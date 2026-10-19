-- ============================================================
-- 0082_quote_memo.sql
-- 견적서 메모 기록(quote_memo) — 견적서 상세에서도 내부 메모를 시간순으로 쌓는다(2026-10-19 사용자 요청, 0080·0081 과 같은 구조).
--   · quote.notes 는 견적서에 '비고'로 인쇄되는 값이라 그대로 둔다. 이 표는 내부 기록 전용 — 견적서·문자·메일엔 안 나간다.
--   · 권한은 견적서를 따라간다(책 컬럼 없이 견적서 조인): 보기 = 그 견적서가 보이면(견적서 RLS = 그 책 viewer 이상,
--     B계좌 격리 그대로), 쓰기 = 그 책 staff 이상, 지우기 = 쓴 사람 본인(지금도 staff 이상)만. 고치기 없음.
--   · 작성 시각·작성자는 트리거가 채운다(클라이언트 값 무시). 작성자 이름은 DB 에만 남기고 화면엔 안 쓴다.
-- ============================================================

CREATE TABLE IF NOT EXISTS quote_memo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         uuid NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  body             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES user_profile(user_id) ON DELETE SET NULL,
  created_by_name  text,
  CONSTRAINT chk_quote_memo_body CHECK (btrim(body) <> '' AND char_length(body) <= 2000)
);
COMMENT ON TABLE quote_memo IS '견적서 메모 기록 — 상세 화면에서 시간순으로 쌓는 내부 메모, 견적서엔 안 나감 (0082, 0080·0081 과 같은 구조)';

CREATE INDEX IF NOT EXISTS idx_quote_memo_quote ON quote_memo (quote_id, created_at);
CREATE INDEX IF NOT EXISTS idx_quote_memo_created_by ON quote_memo (created_by) WHERE created_by IS NOT NULL;

-- 작성 시각·작성자 — 클라이언트가 보낸 값은 쓰지 않는다(0080·0081 fill 함수와 같은 본문).
CREATE OR REPLACE FUNCTION quote_memo_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.body := btrim(NEW.body);
  NEW.created_at := now();
  NEW.created_by := auth.uid();
  NEW.created_by_name := (SELECT p.display_name FROM user_profile p WHERE p.user_id = auth.uid());
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION quote_memo_fill() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_quote_memo_fill ON quote_memo;
CREATE TRIGGER trg_quote_memo_fill
  BEFORE INSERT ON quote_memo
  FOR EACH ROW EXECUTE FUNCTION quote_memo_fill();

ALTER TABLE quote_memo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE quote_memo FROM anon;

DROP POLICY IF EXISTS p_quote_memo_read   ON quote_memo;
DROP POLICY IF EXISTS p_quote_memo_insert ON quote_memo;
DROP POLICY IF EXISTS p_quote_memo_delete ON quote_memo;

-- 보기: 그 견적서가 보이면(서브쿼리에도 견적서 RLS 가 걸린다 = 견적서 책 viewer 이상).
CREATE POLICY p_quote_memo_read ON quote_memo FOR SELECT
  USING (EXISTS (SELECT 1 FROM quote q WHERE q.id = quote_memo.quote_id));

-- 쓰기: 지워지지 않은 견적서 + 그 책 staff 이상 + 작성자는 본인(트리거가 auth.uid() 로 채움).
CREATE POLICY p_quote_memo_insert ON quote_memo FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM quote q
       WHERE q.id = quote_memo.quote_id
         AND q.deleted_at IS NULL
         AND current_user_has_book_role(q.book, 'staff')
    )
  );

-- 지우기: 쓴 사람 본인 + 지금도 그 책 staff 이상(오타 지우기).
CREATE POLICY p_quote_memo_delete ON quote_memo FOR DELETE
  USING (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM quote q
       WHERE q.id = quote_memo.quote_id
         AND current_user_has_book_role(q.book, 'staff')
    )
  );
