-- ============================================================
-- 0001_extensions.sql
-- PostgreSQL 확장 활성화
-- ============================================================

-- UUID 생성 (Supabase는 pgcrypto/uuid-ossp 중 pgcrypto의 gen_random_uuid()를 권장)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 거래처명 부분 검색 (GIN trgm 인덱스)
-- Supabase 권장: 비-system 확장은 'extensions' 스키마에 설치 (public 노출 방지)
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;

-- 타임존 (Supabase 기본 UTC, 화면 표시는 KST는 application 레이어에서)
-- (별도 확장 불필요)
