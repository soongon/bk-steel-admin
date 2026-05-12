-- ============================================================
-- 0028_fix_user_role_rls_recursion.sql
-- user_book_role / user_profile 정책 내 EXISTS subquery가 자기 자신을 참조 → infinite recursion
--
-- 원인 흐름:
--   1) sale 등 거래 테이블 정책이 current_user_has_book_role() 호출 (SECURITY INVOKER)
--   2) 함수가 user_book_role SELECT
--   3) user_book_role 정책의 'OR EXISTS (SELECT FROM user_book_role ...)' 발화
--   4) 그 EXISTS subquery가 user_book_role을 다시 쿼리 → 정책 다시 발화 → 무한 반복
--
-- 해결: user_book_role / user_profile 의 SELECT 정책을 '자기 row만' 으로 단순화.
-- 쓰기 정책은 SECURITY INVOKER helper(current_user_is_owner_or_manager_any_book) 사용 —
-- helper는 user_book_role을 self-only RLS로 읽어 자기 owner 여부 확인 → recursion 없음.
-- ============================================================

-- ---- user_book_role ----
DROP POLICY IF EXISTS p_user_book_role_read   ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_insert ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_update ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_delete ON user_book_role;

CREATE POLICY p_user_book_role_read ON user_book_role FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY p_user_book_role_insert ON user_book_role FOR INSERT
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_user_book_role_update ON user_book_role FOR UPDATE
  USING (current_user_is_owner_or_manager_any_book())
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_user_book_role_delete ON user_book_role FOR DELETE
  USING (current_user_is_owner_or_manager_any_book());

-- ---- user_profile ----
DROP POLICY IF EXISTS p_user_profile_read   ON user_profile;
DROP POLICY IF EXISTS p_user_profile_insert ON user_profile;
DROP POLICY IF EXISTS p_user_profile_update ON user_profile;
DROP POLICY IF EXISTS p_user_profile_delete ON user_profile;

CREATE POLICY p_user_profile_read ON user_profile FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY p_user_profile_insert ON user_profile FOR INSERT
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_user_profile_update ON user_profile FOR UPDATE
  USING (current_user_is_owner_or_manager_any_book())
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_user_profile_delete ON user_profile FOR DELETE
  USING (current_user_is_owner_or_manager_any_book());

-- 참고: SELECT는 'self only' 만 허용. 향후 owner가 다른 사용자의 user_profile/role을 조회/관리해야
-- 한다면, SECURITY DEFINER admin view나 RPC 함수를 별도로 도입하는 것이 안전.
