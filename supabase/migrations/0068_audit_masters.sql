-- ============================================================
-- 0068_audit_masters.sql
-- 감사 로그(audit_log) 트리거를 핵심 마스터에도 부착.
-- 0017 은 거래성·금융 테이블 + site(0031)·company_profile(0029)만 기록했고
-- partner(거래처)·item(품목)·business_card(명함)·sales_log(영업내역)는 빠져 있었다.
-- 거래처명은 매출·세금계산서 정합성 기준(절대 룰 #3)이라 이름·사업자번호 변경 이력이 남아야 한다.
--
-- audit_trigger_fn() 재사용(0017/0027) — book 컬럼 없는 마스터는 v_book NULL → sensitive FALSE
-- (site·company_profile 이 이미 동일 방식으로 동작 중). 소급 기록은 불가, 적용 이후 변경부터 기록.
-- ============================================================

DROP TRIGGER IF EXISTS trg_audit_partner ON partner;
CREATE TRIGGER trg_audit_partner
  AFTER INSERT OR UPDATE OR DELETE ON partner
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_item ON item;
CREATE TRIGGER trg_audit_item
  AFTER INSERT OR UPDATE OR DELETE ON item
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_business_card ON business_card;
CREATE TRIGGER trg_audit_business_card
  AFTER INSERT OR UPDATE OR DELETE ON business_card
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS trg_audit_sales_log ON sales_log;
CREATE TRIGGER trg_audit_sales_log
  AFTER INSERT OR UPDATE OR DELETE ON sales_log
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
