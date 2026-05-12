-- ============================================================
-- 0022_rls_optimization.sql
-- Performance Advisor 16개 WARN 일괄 패치 (기존 remote DB용)
--
-- 1. auth_rls_initplan (4 warnings)
--    auth.uid() → (SELECT auth.uid()) : PG가 1회만 평가 (initplan caching)
--
-- 2. multiple_permissive_policies (12 warnings = 2 tables × 6 roles)
--    user_profile / user_book_role 의 self + admin 정책이 둘 다 SELECT에 발화
--    → SELECT 정책 1개로 통합, 쓰기는 INSERT/UPDATE/DELETE 분리
--
-- 신규 환경의 0019_rls.sql 도 동일 내용으로 갱신됨
-- ============================================================

-- ---- user_profile ----
DROP POLICY IF EXISTS p_user_profile_self   ON user_profile;
DROP POLICY IF EXISTS p_user_profile_admin  ON user_profile;
DROP POLICY IF EXISTS p_user_profile_read   ON user_profile;
DROP POLICY IF EXISTS p_user_profile_insert ON user_profile;
DROP POLICY IF EXISTS p_user_profile_update ON user_profile;
DROP POLICY IF EXISTS p_user_profile_delete ON user_profile;

CREATE POLICY p_user_profile_read ON user_profile FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_book_role
       WHERE user_id = (SELECT auth.uid()) AND role = 'owner'
    )
  );

CREATE POLICY p_user_profile_insert ON user_profile FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_book_role
       WHERE user_id = (SELECT auth.uid()) AND role = 'owner'
    )
  );

CREATE POLICY p_user_profile_update ON user_profile FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_book_role
       WHERE user_id = (SELECT auth.uid()) AND role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_book_role
       WHERE user_id = (SELECT auth.uid()) AND role = 'owner'
    )
  );

CREATE POLICY p_user_profile_delete ON user_profile FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_book_role
       WHERE user_id = (SELECT auth.uid()) AND role = 'owner'
    )
  );

-- ---- user_book_role ----
DROP POLICY IF EXISTS p_user_book_role_self   ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_admin  ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_read   ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_insert ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_update ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_delete ON user_book_role;

CREATE POLICY p_user_book_role_read ON user_book_role FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_book_role r
       WHERE r.user_id = (SELECT auth.uid()) AND r.role = 'owner'
    )
  );

CREATE POLICY p_user_book_role_insert ON user_book_role FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_book_role r
       WHERE r.user_id = (SELECT auth.uid()) AND r.role = 'owner'
    )
  );

CREATE POLICY p_user_book_role_update ON user_book_role FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_book_role r
       WHERE r.user_id = (SELECT auth.uid()) AND r.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_book_role r
       WHERE r.user_id = (SELECT auth.uid()) AND r.role = 'owner'
    )
  );

CREATE POLICY p_user_book_role_delete ON user_book_role FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_book_role r
       WHERE r.user_id = (SELECT auth.uid()) AND r.role = 'owner'
    )
  );
