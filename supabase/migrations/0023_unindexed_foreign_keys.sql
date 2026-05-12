-- ============================================================
-- 0023_unindexed_foreign_keys.sql
-- Performance Advisor 38 INFO: unindexed_foreign_keys 일괄 추가
--
-- FK 컬럼에 인덱스가 없으면 PG가 부모 row 삭제/갱신 시 자식 테이블 전체 스캔
-- → 운영 들어가서 user_profile/partner/item/bank_account 등 마스터 row 갱신 시 느려짐
-- 부수 효과: '이 user가 작성한 모든 row 조회' 같은 쿼리도 빨라짐
-- ============================================================

-- ---- bank_transaction ----
CREATE INDEX IF NOT EXISTS idx_bank_txn_created_by
  ON bank_transaction(created_by) WHERE created_by IS NOT NULL;

-- ---- book_transfer ----
CREATE INDEX IF NOT EXISTS idx_book_transfer_created_by
  ON book_transfer(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_book_transfer_updated_by
  ON book_transfer(updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_book_transfer_source_price_history
  ON book_transfer(source_price_history_id) WHERE source_price_history_id IS NOT NULL;

-- ---- consignment_in ----
CREATE INDEX IF NOT EXISTS idx_consignment_in_created_by
  ON consignment_in(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consignment_in_item
  ON consignment_in(item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consignment_in_zone
  ON consignment_in(warehouse_zone_id) WHERE warehouse_zone_id IS NOT NULL;

-- ---- improvement_idea ----
CREATE INDEX IF NOT EXISTS idx_improvement_idea_proposed_by
  ON improvement_idea(proposed_by) WHERE proposed_by IS NOT NULL;

-- ---- inventory_adjustment ----
CREATE INDEX IF NOT EXISTS idx_inv_adj_created_by
  ON inventory_adjustment(created_by) WHERE created_by IS NOT NULL;

-- ---- item ----
CREATE INDEX IF NOT EXISTS idx_item_rebar_spec
  ON item(rebar_spec_code) WHERE rebar_spec_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_rebar_grade
  ON item(rebar_grade_code) WHERE rebar_grade_code IS NOT NULL;

-- ---- partner ----
CREATE INDEX IF NOT EXISTS idx_partner_created_by
  ON partner(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partner_updated_by
  ON partner(updated_by) WHERE updated_by IS NOT NULL;

-- ---- partner_credit_limit ----
CREATE INDEX IF NOT EXISTS idx_partner_credit_updated_by
  ON partner_credit_limit(updated_by) WHERE updated_by IS NOT NULL;

-- ---- price_history ----
CREATE INDEX IF NOT EXISTS idx_price_history_recorded_by
  ON price_history(recorded_by) WHERE recorded_by IS NOT NULL;

-- ---- promissory_note ----
CREATE INDEX IF NOT EXISTS idx_note_sale
  ON promissory_note(sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_purchase
  ON promissory_note(purchase_id) WHERE purchase_id IS NOT NULL;

-- ---- purchase ----
CREATE INDEX IF NOT EXISTS idx_purchase_created_by
  ON purchase(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_updated_by
  ON purchase(updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_pay_bank
  ON purchase(pay_bank_account_id) WHERE pay_bank_account_id IS NOT NULL;

-- ---- purchase_line ----
CREATE INDEX IF NOT EXISTS idx_purchase_line_item
  ON purchase_line(item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_line_zone
  ON purchase_line(warehouse_zone_id) WHERE warehouse_zone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_line_created_by
  ON purchase_line(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_line_updated_by
  ON purchase_line(updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_line_created_adj
  ON purchase_line(created_by_adjustment_id) WHERE created_by_adjustment_id IS NOT NULL;

-- ---- receipt ----
CREATE INDEX IF NOT EXISTS idx_receipt_created_by
  ON receipt(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipt_pay_bank
  ON receipt(pay_bank_account_id) WHERE pay_bank_account_id IS NOT NULL;

-- ---- recurring_task ----
CREATE INDEX IF NOT EXISTS idx_recurring_task_owner
  ON recurring_task(owner) WHERE owner IS NOT NULL;

-- ---- recurring_task_log ----
CREATE INDEX IF NOT EXISTS idx_recurring_task_log_done_by
  ON recurring_task_log(done_by) WHERE done_by IS NOT NULL;

-- ---- sale ----
CREATE INDEX IF NOT EXISTS idx_sale_created_by
  ON sale(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_updated_by
  ON sale(updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_receive_bank
  ON sale(receive_bank_account_id) WHERE receive_bank_account_id IS NOT NULL;

-- ---- sale_line ----
CREATE INDEX IF NOT EXISTS idx_sale_line_item
  ON sale_line(item_id);

-- ---- sales_log ----
CREATE INDEX IF NOT EXISTS idx_sales_log_created_by
  ON sales_log(created_by) WHERE created_by IS NOT NULL;

-- ---- user_book_role ----
CREATE INDEX IF NOT EXISTS idx_user_book_role_granted_by
  ON user_book_role(granted_by) WHERE granted_by IS NOT NULL;

-- ---- warehouse ----
CREATE INDEX IF NOT EXISTS idx_warehouse_partner
  ON warehouse(partner_id) WHERE partner_id IS NOT NULL;
