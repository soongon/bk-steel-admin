-- ============================================================
-- 0001_extensions.sql
-- PostgreSQL 확장 활성화
-- ============================================================

-- UUID 생성 (Supabase는 pgcrypto/uuid-ossp 중 pgcrypto의 gen_random_uuid()를 권장)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 거래처명 부분 검색 (GIN trgm 인덱스)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 타임존 (Supabase 기본 UTC, 화면 표시는 KST는 application 레이어에서)
-- (별도 확장 불필요)
