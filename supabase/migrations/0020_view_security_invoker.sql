-- ============================================================
-- 0020_view_security_invoker.sql
-- PostgreSQL 15+ 의 view는 명시하지 않으면 SECURITY DEFINER로 동작 (view 생성자 권한)
-- → RLS 우회 위험. 모든 view를 security_invoker = on 으로 강제.
--
-- 새 마이그레이션(0018_views.sql)은 이미 WITH (security_invoker = true) 포함.
-- 본 파일은 기존 remote DB(이미 0018을 적용한 상태)에 ALTER로 패치.
-- 신규 환경에서도 idempotent — 이미 on 이면 no-op.
--
-- 참조: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
-- ============================================================

ALTER VIEW vw_inventory                    SET (security_invoker = on);
ALTER VIEW vw_inventory_by_book_item       SET (security_invoker = on);
ALTER VIEW vw_today_market_price           SET (security_invoker = on);
ALTER VIEW vw_inventory_valuation          SET (security_invoker = on);
ALTER VIEW vw_receivable                   SET (security_invoker = on);
ALTER VIEW vw_payable                      SET (security_invoker = on);
ALTER VIEW vw_book_monthly_pnl_internal    SET (security_invoker = on);
ALTER VIEW vw_book_monthly_pnl_filing      SET (security_invoker = on);
ALTER VIEW vw_vat_eligible_sale            SET (security_invoker = on);
ALTER VIEW vw_vat_eligible_purchase        SET (security_invoker = on);
