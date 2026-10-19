-- ============================================================
-- 0081_purchase_memo.sql
-- 매입 메모 기록(purchase_memo) — 매입 상세에서도 메모를 시간순으로 쌓는다(2026-10-19 사용자 요청, 0080 매출과 같은 구조).
--   · purchase.notes 는 그대로 둔다(목록 메모 칸·상세의 '등록 메모'). 이 표는 상세 화면 기록 전용.
--   · 권한은 매입을 따라간다(책 컬럼 없이 매입 조인): 보기 = 그 매입이 보이면(매입 RLS = 그 책 viewer 이상,
--     B계좌 격리 그대로), 쓰기 = 그 책 staff 이상, 지우기 = 쓴 사람 본인(지금도 staff 이상)만. 고치기 없음.
--   · 작성 시각·작성자는 트리거가 채운다(클라이언트 값 무시). 작성자 이름은 DB 에만 남기고 화면엔 안 쓴다(0080 과 같게).
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_memo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id      uuid NOT NULL REFERENCES purchase(id) ON DELETE CASCADE,
  body             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES user_profile(user_id) ON DELETE SET NULL,
  created_by_name  text,
  CONSTRAINT chk_purchase_memo_body CHECK (btrim(body) <> '' AND char_length(body) <= 2000)
);
COMMENT ON TABLE purchase_memo IS '매입 메모 기록 — 상세 화면에서 시간순으로 쌓는 내부 메모 (0081, 0080 sale_memo 와 같은 구조)';

CREATE INDEX IF NOT EXISTS idx_purchase_memo_purchase ON purchase_memo (purchase_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_memo_created_by ON purchase_memo (created_by) WHERE created_by IS NOT NULL;

-- 작성 시각·작성자 — 클라이언트가 보낸 값은 쓰지 않는다(0080 sale_memo_fill 과 같은 본문).
CREATE OR REPLACE FUNCTION purchase_memo_fill()
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
REVOKE EXECUTE ON FUNCTION purchase_memo_fill() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_purchase_memo_fill ON purchase_memo;
CREATE TRIGGER trg_purchase_memo_fill
  BEFORE INSERT ON purchase_memo
  FOR EACH ROW EXECUTE FUNCTION purchase_memo_fill();

ALTER TABLE purchase_memo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE purchase_memo FROM anon;

DROP POLICY IF EXISTS p_purchase_memo_read   ON purchase_memo;
DROP POLICY IF EXISTS p_purchase_memo_insert ON purchase_memo;
DROP POLICY IF EXISTS p_purchase_memo_delete ON purchase_memo;

-- 보기: 그 매입이 보이면(서브쿼리에도 매입 RLS 가 걸린다 = 매입 책 viewer 이상).
CREATE POLICY p_purchase_memo_read ON purchase_memo FOR SELECT
  USING (EXISTS (SELECT 1 FROM purchase pu WHERE pu.id = purchase_memo.purchase_id));

-- 쓰기: 지워지지 않은 매입 + 그 책 staff 이상 + 작성자는 본인(트리거가 auth.uid() 로 채움).
CREATE POLICY p_purchase_memo_insert ON purchase_memo FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM purchase pu
       WHERE pu.id = purchase_memo.purchase_id
         AND pu.deleted_at IS NULL
         AND current_user_has_book_role(pu.book, 'staff')
    )
  );

-- 지우기: 쓴 사람 본인 + 지금도 그 책 staff 이상(오타 지우기).
CREATE POLICY p_purchase_memo_delete ON purchase_memo FOR DELETE
  USING (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM purchase pu
       WHERE pu.id = purchase_memo.purchase_id
         AND current_user_has_book_role(pu.book, 'staff')
    )
  );
