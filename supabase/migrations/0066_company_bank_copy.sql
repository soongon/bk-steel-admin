-- ============================================================
-- 0066_company_bank_copy.sql
-- 회사정보에 계좌사본 이미지 URL. 인감(stamp_url)과 동일 패턴 — company-stamps 버킷(public) 사용.
-- 명세서에 입금계좌 신뢰 자료로 첨부/표시. B계좌는 SL과 다른 히든 통장이라 책별 독립 저장.
-- ============================================================

ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS bank_copy_url text;
COMMENT ON COLUMN company_profile.bank_copy_url IS '통장(계좌) 사본 이미지 공개 URL. company-stamps 버킷.';
