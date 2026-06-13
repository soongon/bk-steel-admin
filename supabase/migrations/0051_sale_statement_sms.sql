-- 매출 거래명세서 MMS(문자) 전송일 기록 — 라이프사이클 "문자 발송" 추적용
-- 솔라피(CoolSMS)로 명세서 이미지를 거래처에 전송한 날짜.
ALTER TABLE sale ADD COLUMN IF NOT EXISTS statement_sms_sent_on DATE;
COMMENT ON COLUMN sale.statement_sms_sent_on IS '거래명세서 MMS 전송일 (솔라피)';
