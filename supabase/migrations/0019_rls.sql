-- ============================================================
-- 0019_rls.sql
-- Row Level Security 정책 — 책 × 역할 매트릭스 강제
-- 참조: docs/시스템_DB_스키마_v1.md §18
--
-- 패턴:
--  • 거래성(책 컬럼 있음): SELECT viewer / INSERT·UPDATE staff / DELETE manager
--  • book_transfer: source_book·dest_book 양쪽 권한 필요
--  • consignment_in: owner/manager any-book 전용
--  • 공유 마스터: SELECT 인증사용자 / WRITE owner·manager any-book
--  • audit_log: SELECT owner/manager any-book만, INSERT/UPDATE/DELETE 정책 없음 (트리거 SECURITY DEFINER로만 INSERT)
--  • user_profile / user_book_role: 본인 SELECT + owner 전체
-- ============================================================

-- ============================================================
-- A. 거래성 테이블 RLS 활성화
-- ============================================================
ALTER TABLE purchase             ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_line        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_line            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_line_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_transfer        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustment ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_in       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_account         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transaction     ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt              ENABLE ROW LEVEL SECURITY;
ALTER TABLE promissory_note      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log            ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- B. 마스터/운영 테이블 RLS 활성화
-- ============================================================
ALTER TABLE partner              ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_alias        ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_credit_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE item                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_item          ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse            ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_zone       ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_curation       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebar_spec           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebar_grade          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_card        ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_task       ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_task_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE improvement_idea     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_book_role       ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- C. 거래성 표준 패턴 (책 컬럼 있는 테이블)
-- 매크로 대신 명시적으로 반복 — 가독성·디버깅 우선
-- ============================================================

-- ---- purchase ----
DROP POLICY IF EXISTS p_purchase_read   ON purchase;
DROP POLICY IF EXISTS p_purchase_insert ON purchase;
DROP POLICY IF EXISTS p_purchase_update ON purchase;
DROP POLICY IF EXISTS p_purchase_delete ON purchase;
CREATE POLICY p_purchase_read   ON purchase FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_purchase_insert ON purchase FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_purchase_update ON purchase FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_purchase_delete ON purchase FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- ---- purchase_line ----
DROP POLICY IF EXISTS p_purchase_line_read   ON purchase_line;
DROP POLICY IF EXISTS p_purchase_line_insert ON purchase_line;
DROP POLICY IF EXISTS p_purchase_line_update ON purchase_line;
DROP POLICY IF EXISTS p_purchase_line_delete ON purchase_line;
CREATE POLICY p_purchase_line_read   ON purchase_line FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_purchase_line_insert ON purchase_line FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_purchase_line_update ON purchase_line FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_purchase_line_delete ON purchase_line FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- ---- sale ----
DROP POLICY IF EXISTS p_sale_read   ON sale;
DROP POLICY IF EXISTS p_sale_insert ON sale;
DROP POLICY IF EXISTS p_sale_update ON sale;
DROP POLICY IF EXISTS p_sale_delete ON sale;
CREATE POLICY p_sale_read   ON sale FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_sale_insert ON sale FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_sale_update ON sale FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_sale_delete ON sale FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- ---- sale_line ----
DROP POLICY IF EXISTS p_sale_line_read   ON sale_line;
DROP POLICY IF EXISTS p_sale_line_insert ON sale_line;
DROP POLICY IF EXISTS p_sale_line_update ON sale_line;
DROP POLICY IF EXISTS p_sale_line_delete ON sale_line;
CREATE POLICY p_sale_line_read   ON sale_line FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_sale_line_insert ON sale_line FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_sale_line_update ON sale_line FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_sale_line_delete ON sale_line FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- ---- sale_line_allocation (sale_line의 book을 통해 권한 체크) ----
DROP POLICY IF EXISTS p_alloc_read   ON sale_line_allocation;
DROP POLICY IF EXISTS p_alloc_insert ON sale_line_allocation;
DROP POLICY IF EXISTS p_alloc_update ON sale_line_allocation;
DROP POLICY IF EXISTS p_alloc_delete ON sale_line_allocation;
CREATE POLICY p_alloc_read ON sale_line_allocation FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM sale_line sl
     WHERE sl.id = sale_line_allocation.sale_line_id
       AND current_user_has_book_role(sl.book, 'viewer')
  ));
CREATE POLICY p_alloc_insert ON sale_line_allocation FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM sale_line sl
     WHERE sl.id = sale_line_allocation.sale_line_id
       AND current_user_has_book_role(sl.book, 'staff')
  ));
CREATE POLICY p_alloc_update ON sale_line_allocation FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM sale_line sl
     WHERE sl.id = sale_line_allocation.sale_line_id
       AND current_user_has_book_role(sl.book, 'staff')
  ));
CREATE POLICY p_alloc_delete ON sale_line_allocation FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM sale_line sl
     WHERE sl.id = sale_line_allocation.sale_line_id
       AND current_user_has_book_role(sl.book, 'manager')
  ));

-- ---- inventory_adjustment ----
DROP POLICY IF EXISTS p_inv_adj_read   ON inventory_adjustment;
DROP POLICY IF EXISTS p_inv_adj_insert ON inventory_adjustment;
DROP POLICY IF EXISTS p_inv_adj_update ON inventory_adjustment;
DROP POLICY IF EXISTS p_inv_adj_delete ON inventory_adjustment;
CREATE POLICY p_inv_adj_read   ON inventory_adjustment FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_inv_adj_insert ON inventory_adjustment FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_inv_adj_update ON inventory_adjustment FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_inv_adj_delete ON inventory_adjustment FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- ---- bank_account (책 컬럼 있음) ----
DROP POLICY IF EXISTS p_bank_account_read   ON bank_account;
DROP POLICY IF EXISTS p_bank_account_insert ON bank_account;
DROP POLICY IF EXISTS p_bank_account_update ON bank_account;
DROP POLICY IF EXISTS p_bank_account_delete ON bank_account;
CREATE POLICY p_bank_account_read   ON bank_account FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_bank_account_insert ON bank_account FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'manager'));
CREATE POLICY p_bank_account_update ON bank_account FOR UPDATE
  USING (current_user_has_book_role(book, 'manager'))
  WITH CHECK (current_user_has_book_role(book, 'manager'));
CREATE POLICY p_bank_account_delete ON bank_account FOR DELETE
  USING (current_user_has_book_role(book, 'owner'));

-- ---- bank_transaction ----
DROP POLICY IF EXISTS p_bank_txn_read   ON bank_transaction;
DROP POLICY IF EXISTS p_bank_txn_insert ON bank_transaction;
DROP POLICY IF EXISTS p_bank_txn_update ON bank_transaction;
DROP POLICY IF EXISTS p_bank_txn_delete ON bank_transaction;
CREATE POLICY p_bank_txn_read   ON bank_transaction FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_bank_txn_insert ON bank_transaction FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_bank_txn_update ON bank_transaction FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_bank_txn_delete ON bank_transaction FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- ---- receipt ----
DROP POLICY IF EXISTS p_receipt_read   ON receipt;
DROP POLICY IF EXISTS p_receipt_insert ON receipt;
DROP POLICY IF EXISTS p_receipt_update ON receipt;
DROP POLICY IF EXISTS p_receipt_delete ON receipt;
CREATE POLICY p_receipt_read   ON receipt FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_receipt_insert ON receipt FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_receipt_update ON receipt FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_receipt_delete ON receipt FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- ---- promissory_note ----
DROP POLICY IF EXISTS p_note_read   ON promissory_note;
DROP POLICY IF EXISTS p_note_insert ON promissory_note;
DROP POLICY IF EXISTS p_note_update ON promissory_note;
DROP POLICY IF EXISTS p_note_delete ON promissory_note;
CREATE POLICY p_note_read   ON promissory_note FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_note_insert ON promissory_note FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_note_update ON promissory_note FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_note_delete ON promissory_note FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));


-- ============================================================
-- D. book_transfer — 양쪽 책 권한 필요
-- ============================================================
DROP POLICY IF EXISTS p_transfer_read   ON book_transfer;
DROP POLICY IF EXISTS p_transfer_insert ON book_transfer;
DROP POLICY IF EXISTS p_transfer_update ON book_transfer;
DROP POLICY IF EXISTS p_transfer_delete ON book_transfer;
CREATE POLICY p_transfer_read   ON book_transfer FOR SELECT
  USING (current_user_has_book_role(source_book, 'viewer')
      OR current_user_has_book_role(dest_book,   'viewer'));
CREATE POLICY p_transfer_insert ON book_transfer FOR INSERT
  WITH CHECK (current_user_has_book_role(source_book, 'manager')
          AND current_user_has_book_role(dest_book,   'manager'));
CREATE POLICY p_transfer_update ON book_transfer FOR UPDATE
  USING (current_user_has_book_role(source_book, 'manager')
     AND current_user_has_book_role(dest_book,   'manager'))
  WITH CHECK (current_user_has_book_role(source_book, 'manager')
          AND current_user_has_book_role(dest_book,   'manager'));
CREATE POLICY p_transfer_delete ON book_transfer FOR DELETE
  USING (current_user_has_book_role(source_book, 'owner')
     AND current_user_has_book_role(dest_book,   'owner'));


-- ============================================================
-- E. consignment_in — owner/manager any-book만
-- ============================================================
DROP POLICY IF EXISTS p_consignment_all ON consignment_in;
CREATE POLICY p_consignment_all ON consignment_in FOR ALL
  USING (current_user_is_owner_or_manager_any_book())
  WITH CHECK (current_user_is_owner_or_manager_any_book());


-- ============================================================
-- F. 공유 마스터 — SELECT 인증사용자 / WRITE owner·manager
-- ============================================================
-- 공통 헬퍼 사용
CREATE OR REPLACE FUNCTION p_master_select_check() RETURNS BOOLEAN AS $$
  SELECT auth.uid() IS NOT NULL;
$$ LANGUAGE SQL STABLE SET search_path = '';

CREATE OR REPLACE FUNCTION p_master_write_check() RETURNS BOOLEAN AS $$
  SELECT current_user_is_owner_or_manager_any_book();
$$ LANGUAGE SQL STABLE SET search_path = public, pg_temp;

-- partner / partner_alias / partner_credit_limit / item / market_item
-- warehouse / warehouse_zone / rebar_spec / rebar_grade
-- price_history / price_curation / sales_log / business_card
-- recurring_task / recurring_task_log / improvement_idea
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'partner','partner_alias','partner_credit_limit',
    'item','market_item','warehouse','warehouse_zone',
    'rebar_spec','rebar_grade','price_history','price_curation',
    'sales_log','business_card','recurring_task','recurring_task_log','improvement_idea'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS p_%I_read   ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS p_%I_insert ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS p_%I_update ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS p_%I_delete ON %I', tbl, tbl);

    EXECUTE format('CREATE POLICY p_%I_read   ON %I FOR SELECT USING (p_master_select_check())', tbl, tbl);
    EXECUTE format('CREATE POLICY p_%I_insert ON %I FOR INSERT WITH CHECK (p_master_write_check())', tbl, tbl);
    EXECUTE format('CREATE POLICY p_%I_update ON %I FOR UPDATE USING (p_master_write_check()) WITH CHECK (p_master_write_check())', tbl, tbl);
    EXECUTE format('CREATE POLICY p_%I_delete ON %I FOR DELETE USING (p_master_write_check())', tbl, tbl);
  END LOOP;
END $$;


-- ============================================================
-- G. user_profile / user_book_role — 본인 + owner
-- 최적화 적용:
--   • auth.uid() → (SELECT auth.uid()) : initplan caching (PG가 1회만 평가)
--   • SELECT 정책 1개로 통합 : multiple permissive policies 회피
--   • 쓰기 액션은 INSERT/UPDATE/DELETE 분리 (FOR ALL이 SELECT까지 흡수하는 문제 방지)
-- ============================================================

-- ---- user_profile ----
DROP POLICY IF EXISTS p_user_profile_self    ON user_profile;
DROP POLICY IF EXISTS p_user_profile_admin   ON user_profile;
DROP POLICY IF EXISTS p_user_profile_read    ON user_profile;
DROP POLICY IF EXISTS p_user_profile_insert  ON user_profile;
DROP POLICY IF EXISTS p_user_profile_update  ON user_profile;
DROP POLICY IF EXISTS p_user_profile_delete  ON user_profile;

-- SELECT는 자기 row만. (owner가 타 사용자 user_profile 조회 필요시 별도 admin RPC로)
CREATE POLICY p_user_profile_read ON user_profile FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- 쓰기는 owner만 — helper 함수로 (user_book_role 직접 EXISTS 시 recursion)
CREATE POLICY p_user_profile_insert ON user_profile FOR INSERT
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_user_profile_update ON user_profile FOR UPDATE
  USING (current_user_is_owner_or_manager_any_book())
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_user_profile_delete ON user_profile FOR DELETE
  USING (current_user_is_owner_or_manager_any_book());

-- ---- user_book_role ----
DROP POLICY IF EXISTS p_user_book_role_self    ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_admin   ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_read    ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_insert  ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_update  ON user_book_role;
DROP POLICY IF EXISTS p_user_book_role_delete  ON user_book_role;

-- user_book_role SELECT는 자기 row만 (다른 정책에서 이 테이블 참조 시 EXISTS subquery → recursion 방지)
CREATE POLICY p_user_book_role_read ON user_book_role FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- 쓰기는 owner만 — helper 함수 사용 (self-only RLS 적용된 user_book_role을 읽어 자기 owner 여부 확인)
CREATE POLICY p_user_book_role_insert ON user_book_role FOR INSERT
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_user_book_role_update ON user_book_role FOR UPDATE
  USING (current_user_is_owner_or_manager_any_book())
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_user_book_role_delete ON user_book_role FOR DELETE
  USING (current_user_is_owner_or_manager_any_book());


-- ============================================================
-- H. audit_log — owner/manager만 SELECT, 사용자 직접 변경 금지
-- (트리거는 SECURITY DEFINER 함수로 RLS 우회하여 INSERT)
-- ============================================================
DROP POLICY IF EXISTS p_audit_read ON audit_log;
CREATE POLICY p_audit_read ON audit_log FOR SELECT
  USING (current_user_is_owner_or_manager_any_book());
-- INSERT/UPDATE/DELETE 정책 없음 → 일반 사용자 접근 불가
