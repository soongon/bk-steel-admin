-- ============================================================
-- 0029_company_profile.sql
-- 거래명세표·세금계산서 등 외부 발급 문서의 공급자(우리) 정보.
-- 책별 row (bk/sl/b) — 초기엔 sl == b (B계좌도 실질 SL 사업자 운영)
-- v1: 텍스트 정보만. v1.1에서 stamp_url(인감 PNG) 활용 예정
-- ============================================================

CREATE TABLE IF NOT EXISTS company_profile (
  book              book_type PRIMARY KEY,
  name              TEXT NOT NULL,
  business_no       TEXT NOT NULL,                 -- 사업자등록번호
  representative    TEXT,
  address           TEXT,
  business_type     TEXT,                          -- 업태
  business_item     TEXT,                          -- 종목
  phone             TEXT,
  fax               TEXT,
  mobile            TEXT,
  email             TEXT,
  bank_default_name TEXT,                          -- 명세서에 표기할 기본 입금 계좌 (선택)
  bank_default_no   TEXT,
  stamp_url         TEXT,                          -- 인감 이미지 URL (v1.1)
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        UUID REFERENCES user_profile(user_id)
);

-- updated_at 자동 갱신
DROP TRIGGER IF EXISTS trg_company_profile_updated_at ON company_profile;
CREATE TRIGGER trg_company_profile_updated_at
  BEFORE UPDATE ON company_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- audit_log 트리거 — book 컬럼 있음 → 자동 기록됨
DROP TRIGGER IF EXISTS trg_audit_company_profile ON company_profile;
CREATE TRIGGER trg_audit_company_profile
  AFTER INSERT OR UPDATE OR DELETE ON company_profile
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- RLS — 모든 인증사용자 SELECT (명세서 생성 시 필요), owner/manager만 변경
ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_company_profile_read   ON company_profile;
DROP POLICY IF EXISTS p_company_profile_insert ON company_profile;
DROP POLICY IF EXISTS p_company_profile_update ON company_profile;
DROP POLICY IF EXISTS p_company_profile_delete ON company_profile;

CREATE POLICY p_company_profile_read ON company_profile FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY p_company_profile_insert ON company_profile FOR INSERT
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_company_profile_update ON company_profile FOR UPDATE
  USING (current_user_is_owner_or_manager_any_book())
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_company_profile_delete ON company_profile FOR DELETE
  USING (current_user_is_owner_or_manager_any_book());

-- ============================================================
-- 초기 시드 — fresh install / 멱등 (ON CONFLICT DO NOTHING)
-- 운영자가 실제 정보로 어드민 페이지에서 갱신
-- ============================================================

INSERT INTO company_profile (book, name, business_no, representative, address, business_type, business_item, phone, fax, mobile, email)
VALUES
  ('bk', 'BK철강 주식회사', '000-00-00000', '(법인 대표자)', '경상북도 경주시 (사업장 주소)',
   '도매 및 소매업', '철강재 / 형강 / 철근',
   '054-000-0000', '054-000-0001', '010-0000-0000', 'info@bk-steel.example'),
  ('sl', 'SL철강', '111-11-11111', '(사업자 대표자)', '경상북도 경주시 (사업장 주소)',
   '도매 및 소매업', '철강재',
   '054-111-1111', NULL, '010-1111-1111', NULL),
  ('b',  'SL철강', '111-11-11111', '(사업자 대표자)', '경상북도 경주시 (사업장 주소)',
   '도매 및 소매업', '철강재',
   '054-111-1111', NULL, '010-1111-1111', NULL)
ON CONFLICT (book) DO NOTHING;

-- PostgREST schema cache 강제 reload (새 테이블이 즉시 API에 노출되도록)
NOTIFY pgrst, 'reload schema';
