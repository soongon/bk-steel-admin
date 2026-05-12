-- ============================================================
-- 0032_site_owner.sql
-- site 에 건축주 정보 추가.
-- 납품확인서는 준공검사 자료로 건축주(관급은 사업명) 와 주소가 반드시 표기되어야 함.
-- client_name(시공사) 는 그대로 유지 — 두 개념 분리.
-- ============================================================

ALTER TABLE site ADD COLUMN IF NOT EXISTS owner_name    TEXT;  -- 건축주 (관급은 사업명)
ALTER TABLE site ADD COLUMN IF NOT EXISTS owner_address TEXT;  -- 건축주·발주청 주소

NOTIFY pgrst, 'reload schema';
