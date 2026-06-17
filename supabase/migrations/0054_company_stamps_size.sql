-- ============================================================
-- 0054_company_stamps_size.sql
-- 인감 버킷(company-stamps) 크기 한도 1MB → 4MB.
-- Next Server Action bodySizeLimit('4mb')·앱 검증(4MB)과 일치.
-- 0033 은 ON CONFLICT DO NOTHING 이라 이미 생성된 버킷엔 반영 안 됨 → UPDATE 필요.
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = 4194304   -- 4MB
WHERE id = 'company-stamps';
