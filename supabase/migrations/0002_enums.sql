-- ============================================================
-- 0002_enums.sql
-- 도메인 enum 타입 정의
-- 참조: docs/시스템_DB_스키마_v1.md §1
-- ============================================================

-- 책 (3축)
DO $$ BEGIN
  CREATE TYPE book_type AS ENUM ('bk', 'sl', 'b');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 자료 종류 (세금계산서 등)
DO $$ BEGIN
  CREATE TYPE tax_doc_type AS ENUM (
    'tax_invoice_electronic',
    'tax_invoice_paper',
    'invoice',
    'cash_receipt',
    'simple_receipt',
    'none'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 부가세 유형
DO $$ BEGIN
  CREATE TYPE vat_type AS ENUM ('standard_10', 'zero_rated', 'exempt', 'non_taxable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 거래 단위
DO $$ BEGIN
  CREATE TYPE acquired_unit AS ENUM ('ton', 'kg', 'ea', 'piece', 'bundle', 'set');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 단가 기준 (이론중량 / 실중량)
DO $$ BEGIN
  CREATE TYPE price_basis AS ENUM ('theoretical', 'actual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 매입 상태머신
DO $$ BEGIN
  CREATE TYPE purchase_status AS ENUM (
    'ordered', 'in_stock', 'partial_out', 'depleted', 'transferred_out', 'scrapped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 매출 상태머신
DO $$ BEGIN
  CREATE TYPE sale_status AS ENUM (
    'reserved', 'confirmed', 'delivered', 'settled', 'overdue', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 거래 subtype
DO $$ BEGIN
  CREATE TYPE sale_subtype AS ENUM ('external', 'inter_book_transfer', 'internal_reclass');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE purchase_subtype AS ENUM ('external', 'inter_book_transfer', 'internal_reclass');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 책 간 이관 헤더 전용
DO $$ BEGIN
  CREATE TYPE book_transfer_type AS ENUM ('inter_book_transfer', 'internal_reclass');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 재고 조정
DO $$ BEGIN
  CREATE TYPE inventory_adjustment_kind AS ENUM ('transform', 'delta');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE inventory_adjustment_reason AS ENUM (
    'cut', 'split', 'merge', 'stocktake', 'loss', 'scrap', 'return_in', 'return_out'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 통장 종류
DO $$ BEGIN
  CREATE TYPE bank_account_kind AS ENUM ('corporate', 'personal', 'b_hidden');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 미수 등급
DO $$ BEGIN
  CREATE TYPE receivable_grade AS ENUM ('normal', 'short', 'mid', 'long');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 시세
DO $$ BEGIN
  CREATE TYPE price_type AS ENUM ('wholesale', 'retail', 'scrap', 'spot');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE price_source AS ENUM ('manual', 'external', 'purchase_derived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 창고 종류
DO $$ BEGIN
  CREATE TYPE warehouse_kind AS ENUM ('owned', 'partner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 사용자 역할
DO $$ BEGIN
  CREATE TYPE book_role AS ENUM ('owner', 'manager', 'staff', 'accountant', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 어음
DO $$ BEGIN
  CREATE TYPE promissory_note_direction AS ENUM ('received', 'issued');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE promissory_note_status AS ENUM ('open', 'collected', 'dishonored', 'endorsed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
