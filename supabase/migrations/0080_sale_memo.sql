-- ============================================================
-- 0080_sale_memo.sql
-- 매출 메모 기록(sale_memo) — 매출 상세에서 메모를 여러 번 남기고 시간순으로 본다(2026-10-19 사용자 요청).
--   · 배경: sale.notes 는 한 칸짜리(매출 등록·수정 폼의 '메모')라 고쳐 쓰면 앞 내용이 사라지고 언제 적었는지 모른다.
--     통화·입금 약속·납품 변경 같은 진행 기록을 쌓을 곳이 필요했다.
--   · sale.notes 는 그대로 둔다(목록 메모 칸·상세의 '등록 메모'). 이 표는 상세 화면 기록 전용 — 명세표·문자·메일엔 안 나간다.
--   · 권한은 매출을 따라간다(책 컬럼을 따로 두지 않고 매출을 조인): 보기 = 그 매출을 볼 수 있는 사람(매출 RLS =
--     그 책 viewer 이상, B계좌 격리 그대로), 쓰기 = 그 책 staff 이상, 지우기 = 쓴 사람 본인(지금도 staff 이상)만.
--     고치기는 없다(기록이므로 — UPDATE 정책 없음 = 거부).
--   · 작성 시각·작성자는 트리거가 채운다(클라이언트 값 무시). user_profile 은 본인 행만 읽히므로(0028) 다른 사람이
--     쓴 메모의 이름을 보여 주려고 작성 당시 display_name 을 created_by_name 에 같이 저장한다.
-- ============================================================

CREATE TABLE IF NOT EXISTS sale_memo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id          uuid NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
  body             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES user_profile(user_id) ON DELETE SET NULL,
  created_by_name  text,
  CONSTRAINT chk_sale_memo_body CHECK (btrim(body) <> '' AND char_length(body) <= 2000)
);
COMMENT ON TABLE sale_memo IS '매출 메모 기록 — 상세 화면에서 시간순으로 쌓는 내부 메모, 명세표·문자엔 안 나감 (0080)';
COMMENT ON COLUMN sale_memo.created_by_name IS '작성 당시 user_profile.display_name — 프로필은 본인 행만 읽혀서 같이 저장 (0080)';

CREATE INDEX IF NOT EXISTS idx_sale_memo_sale ON sale_memo (sale_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sale_memo_created_by ON sale_memo (created_by) WHERE created_by IS NOT NULL;

-- 작성 시각·작성자 — 클라이언트가 보낸 값은 쓰지 않는다.
CREATE OR REPLACE FUNCTION sale_memo_fill()
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
REVOKE EXECUTE ON FUNCTION sale_memo_fill() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_sale_memo_fill ON sale_memo;
CREATE TRIGGER trg_sale_memo_fill
  BEFORE INSERT ON sale_memo
  FOR EACH ROW EXECUTE FUNCTION sale_memo_fill();

ALTER TABLE sale_memo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sale_memo FROM anon;

DROP POLICY IF EXISTS p_sale_memo_read   ON sale_memo;
DROP POLICY IF EXISTS p_sale_memo_insert ON sale_memo;
DROP POLICY IF EXISTS p_sale_memo_delete ON sale_memo;

-- 보기: 그 매출이 보이면(서브쿼리에도 매출 RLS 가 걸린다 = 매출 책 viewer 이상).
CREATE POLICY p_sale_memo_read ON sale_memo FOR SELECT
  USING (EXISTS (SELECT 1 FROM sale s WHERE s.id = sale_memo.sale_id));

-- 쓰기: 지워지지 않은 매출 + 그 책 staff 이상 + 작성자는 본인(트리거가 auth.uid() 로 채움).
CREATE POLICY p_sale_memo_insert ON sale_memo FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM sale s
       WHERE s.id = sale_memo.sale_id
         AND s.deleted_at IS NULL
         AND current_user_has_book_role(s.book, 'staff')
    )
  );

-- 지우기: 쓴 사람 본인 + 지금도 그 책 staff 이상(오타 지우기).
CREATE POLICY p_sale_memo_delete ON sale_memo FOR DELETE
  USING (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM sale s
       WHERE s.id = sale_memo.sale_id
         AND current_user_has_book_role(s.book, 'staff')
    )
  );
