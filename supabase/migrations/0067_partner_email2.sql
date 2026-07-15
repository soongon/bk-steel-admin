-- ============================================================
-- 0067_partner_email2.sql
-- 거래처 2번째 이메일. 세금계산서 발행 시 email(=1번)은 팝빌 invoiceeEmail1 로 자동 송부되고,
-- email2 는 발행 후 팝빌 sendEmail(재전송)로 추가 발송 → 두 담당자 모두 계산서 수신.
-- ============================================================

ALTER TABLE partner ADD COLUMN IF NOT EXISTS email2 TEXT;
COMMENT ON COLUMN partner.email2 IS '거래처 2번째 담당자 이메일 (세금계산서 추가 수신처).';
