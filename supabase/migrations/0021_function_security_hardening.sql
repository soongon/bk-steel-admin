-- ============================================================
-- 0021_function_security_hardening.sql
-- Supabase Security Advisor 잔여 3종 일괄 패치 (기존 remote DB용 ALTER)
--
-- 1. function_search_path_mutable (WARN x10)
--    → ALTER FUNCTION ... SET search_path = ...
--
-- 2. anon/authenticated_security_definer_function_executable (WARN x8 = 4 func x 2 role)
--    → 트리거 함수: REVOKE EXECUTE (트리거는 권한 우회로 정상 동작)
--    → RLS 헬퍼 함수: ALTER ... SECURITY INVOKER (user_book_role RLS가 자기 row 허용)
--
-- 3. extension_in_public (WARN x1)
--    → ALTER EXTENSION pg_trgm SET SCHEMA extensions
--
-- 신규 환경의 0001~0019 소스 파일도 동일 내용으로 갱신됨 (idempotent — 이미 set이면 no-op)
-- ============================================================

-- ============================================================
-- 1. search_path 명시 — 함수 hijack 방지
--    SECURITY INVOKER 함수도 권장됨
-- ============================================================
ALTER FUNCTION public.set_updated_at()
  SET search_path = '';

ALTER FUNCTION public.current_user_has_book_role(book_type, book_role)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.current_user_is_owner_or_manager_any_book()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.audit_trigger_fn()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.price_history_autofill_from_purchase()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.rebar_weight_kg(text, integer, numeric)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.rebar_bars_for_tons(text, numeric, numeric)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.rebar_weight_by_bundles(text, integer)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.p_master_select_check()
  SET search_path = '';

ALTER FUNCTION public.p_master_write_check()
  SET search_path = public, pg_temp;

-- ============================================================
-- 2-a. RLS 헬퍼 함수: SECURITY DEFINER → SECURITY INVOKER
--      user_book_role 테이블의 RLS가 자기 row(user_id = auth.uid()) 읽기 허용하므로
--      DEFINER로 RLS 우회할 필요 없음. INVOKER가 더 안전.
-- ============================================================
ALTER FUNCTION public.current_user_has_book_role(book_type, book_role)
  SECURITY INVOKER;

ALTER FUNCTION public.current_user_is_owner_or_manager_any_book()
  SECURITY INVOKER;

-- ============================================================
-- 2-b. 트리거 전용 함수: PostgREST RPC 노출 방지를 위해 EXECUTE 회수
--      트리거 시스템 내부 호출은 EXECUTE 권한 체크 우회하므로 트리거 동작 영향 없음
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.audit_trigger_fn() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_trigger_fn() FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.price_history_autofill_from_purchase() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.price_history_autofill_from_purchase() FROM anon, authenticated;

-- ============================================================
-- 3. pg_trgm: public → extensions 스키마 이동
--    GIN trgm 인덱스(idx_partner_name_trgm 등)는 자동으로 새 위치 추적
-- ============================================================
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
