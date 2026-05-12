-- ============================================================
-- 0003_auth_users.sql
-- 사용자 프로필 + 책별 권한 매트릭스 + 헬퍼 함수
-- 참조: docs/시스템_DB_스키마_v1.md §2
-- ============================================================

-- 사용자 프로필 (auth.users 의 확장)
CREATE TABLE IF NOT EXISTS user_profile (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  phone         TEXT,
  is_owner      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 책 × 역할 매트릭스
CREATE TABLE IF NOT EXISTS user_book_role (
  user_id     UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
  book        book_type NOT NULL,
  role        book_role NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by  UUID REFERENCES user_profile(user_id),
  PRIMARY KEY (user_id, book)
);

CREATE INDEX IF NOT EXISTS idx_user_book_role_user ON user_book_role(user_id);

-- ============================================================
-- 헬퍼: 현재 사용자가 특정 책에 최소 역할 이상 보유하는지
-- 위계: viewer < staff = accountant < manager < owner
-- ============================================================
CREATE OR REPLACE FUNCTION current_user_has_book_role(
  p_book      book_type,
  p_min_role  book_role
) RETURNS BOOLEAN AS $$
DECLARE
  v_role book_role;
BEGIN
  SELECT role INTO v_role
    FROM user_book_role
   WHERE user_id = auth.uid() AND book = p_book;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN CASE p_min_role
    WHEN 'viewer'     THEN TRUE
    WHEN 'staff'      THEN v_role IN ('staff','manager','owner','accountant')
    WHEN 'accountant' THEN v_role IN ('accountant','manager','owner')
    WHEN 'manager'    THEN v_role IN ('manager','owner')
    WHEN 'owner'      THEN v_role = 'owner'
  END;
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER
   SET search_path = public, pg_temp;
-- SECURITY INVOKER: user_book_role의 RLS가 자기 row만 보게 허용하므로 SECURITY DEFINER 불필요
-- search_path: 외부 schema에서 동일 이름 함수/테이블이 인터셉트하는 것을 방지

-- ============================================================
-- 헬퍼: 현재 사용자가 owner/manager 역할을 어떤 책에든 보유하는지
-- (마스터·공유 테이블 WRITE 권한 체크용)
-- ============================================================
CREATE OR REPLACE FUNCTION current_user_is_owner_or_manager_any_book()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_book_role
     WHERE user_id = auth.uid()
       AND role IN ('owner','manager')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER
   SET search_path = public, pg_temp;

-- ============================================================
-- updated_at 자동 갱신 트리거 함수 (공통 사용)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- user_profile 에 적용
DROP TRIGGER IF EXISTS trg_user_profile_updated_at ON user_profile;
CREATE TRIGGER trg_user_profile_updated_at
  BEFORE UPDATE ON user_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
