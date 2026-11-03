-- ============================================================
-- 0098_inquiry_memo.sql
-- 문의 메모 기록(inquiry_memo) — 문의 상세에서도 내부 메모를 시간순으로 쌓는다(2026-11-03 사용자 요청, 0080·0081·0082 와 같은 구조).
--   · 문의 원본은 홈페이지 전용 Supabase(다른 프로젝트)의 inquiries — FK 를 걸 수 없어 inquiry_id 는 uuid 값만 저장한다.
--     문의가 있는지는 어드민 서버(lib/homepage-inquiry.ts)가 확인하고, 문의를 지울 때 purge_inquiry_memos 로 같이 지운다.
--   · 문의는 책과 무관한 공유 영역이라 권한도 책을 가리지 않는다(어드민 문의 화면 checkAccess 와 같은 기준):
--     보기 = 어느 책이든 역할이 있으면, 쓰기 = 어느 책이든 staff 이상, 지우기 = 쓴 사람 본인 + staff 이상. 고치기 없음.
--   · 작성 시각·작성자는 트리거가 채운다(클라이언트 값 무시). 작성자 이름은 DB 에만 남기고 화면엔 안 쓴다.
--   · 홈페이지 DB 로는 아무것도 보내지 않는다(내부 메모는 어드민에만).
-- ============================================================

CREATE TABLE IF NOT EXISTS inquiry_memo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id       uuid NOT NULL, -- 홈페이지 DB inquiries.id (다른 프로젝트라 FK 없음)
  body             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES user_profile(user_id) ON DELETE SET NULL,
  created_by_name  text,
  CONSTRAINT chk_inquiry_memo_body CHECK (btrim(body) <> '' AND char_length(body) <= 2000)
);
COMMENT ON TABLE inquiry_memo IS '문의 메모 기록 — 문의 상세에서 시간순으로 쌓는 내부 메모, 홈페이지엔 안 나감 (0098, 0080~0082 와 같은 구조, inquiry_id 는 홈페이지 DB 값)';

CREATE INDEX IF NOT EXISTS idx_inquiry_memo_inquiry ON inquiry_memo (inquiry_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inquiry_memo_created_by ON inquiry_memo (created_by) WHERE created_by IS NOT NULL;

-- 어느 책이든 staff 이상인지(current_user_has_book_role 의 staff 와 같은 역할 집합). user_book_role RLS 는 본인 행만 보인다.
CREATE OR REPLACE FUNCTION current_user_has_any_staff_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_book_role r
     WHERE r.user_id = auth.uid()
       AND r.role IN ('staff', 'manager', 'owner', 'accountant')
  );
$$;
REVOKE EXECUTE ON FUNCTION current_user_has_any_staff_role() FROM anon;

-- 작성 시각·작성자 — 클라이언트가 보낸 값은 쓰지 않는다(0080~0082 fill 함수와 같은 본문).
CREATE OR REPLACE FUNCTION inquiry_memo_fill()
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
REVOKE EXECUTE ON FUNCTION inquiry_memo_fill() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_inquiry_memo_fill ON inquiry_memo;
CREATE TRIGGER trg_inquiry_memo_fill
  BEFORE INSERT ON inquiry_memo
  FOR EACH ROW EXECUTE FUNCTION inquiry_memo_fill();

ALTER TABLE inquiry_memo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inquiry_memo FROM anon;

DROP POLICY IF EXISTS p_inquiry_memo_read   ON inquiry_memo;
DROP POLICY IF EXISTS p_inquiry_memo_insert ON inquiry_memo;
DROP POLICY IF EXISTS p_inquiry_memo_delete ON inquiry_memo;

-- 보기: 어느 책이든 역할이 있으면(문의 화면을 볼 수 있는 사람).
CREATE POLICY p_inquiry_memo_read ON inquiry_memo FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_book_role r WHERE r.user_id = (SELECT auth.uid())));

-- 쓰기: 어느 책이든 staff 이상 + 작성자는 본인(트리거가 auth.uid() 로 채움).
CREATE POLICY p_inquiry_memo_insert ON inquiry_memo FOR INSERT
  WITH CHECK (created_by = (SELECT auth.uid()) AND current_user_has_any_staff_role());

-- 지우기: 쓴 사람 본인 + 지금도 staff 이상(오타 지우기).
CREATE POLICY p_inquiry_memo_delete ON inquiry_memo FOR DELETE
  USING (created_by = (SELECT auth.uid()) AND current_user_has_any_staff_role());

-- 문의 삭제 때 그 문의의 메모를 모두 지운다(남이 쓴 메모 포함 — FK CASCADE 대신). staff 이상만, 지운 건수를 돌려준다.
CREATE OR REPLACE FUNCTION purge_inquiry_memos(p_inquiry_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT current_user_has_any_staff_role() THEN
    RAISE EXCEPTION '권한이 없습니다 (staff 이상 필요).' USING ERRCODE = '42501';
  END IF;
  DELETE FROM inquiry_memo WHERE inquiry_id = p_inquiry_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION purge_inquiry_memos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION purge_inquiry_memos(uuid) TO authenticated;
