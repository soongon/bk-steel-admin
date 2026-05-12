-- ============================================================
-- 0024_partner_add_email.sql
-- partner 테이블에 email 컬럼 추가 (거래처 담당자 이메일)
-- 전자세금계산서 발행·견적 알림 등에 사용
-- ============================================================

ALTER TABLE partner ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN partner.email IS '거래처 담당자 이메일 (전자세금계산서·견적 알림 등)';
