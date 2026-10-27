-- ============================================================
-- 0092_hometax_purchase.sql
-- 매입 — 팝빌 매입 엑셀 업서트 (기획 §15, 사장 결정 2026-10-27: 분류 = 거래처 표시 + 처음 보는 공급자는 대기, 비용은 영수증, 결제예정 +30일)
--   · partner.supply_kind : inventory(재고 공급처 → 매입 생성) / expense(비용 업체 → 영수증 생성) / NULL(미분류 → 분류 대기).
--     계산서 공급자를 처음 볼 때 NULL 로 두고 사장이 한 번 정하면 그 거래처의 다음 계산서부터 자동.
--   · purchase.origin/origin_ref, receipt.origin/origin_ref : 홈택스 수집본에서 자동 생성된 행 표시(매출 0087 과 같은 모양).
--   · hometax_invoice.receipt_id : 비용으로 처리된 수집본의 연결.
-- ============================================================

ALTER TABLE partner ADD COLUMN IF NOT EXISTS supply_kind TEXT;
ALTER TABLE partner DROP CONSTRAINT IF EXISTS chk_partner_supply_kind;
ALTER TABLE partner ADD CONSTRAINT chk_partner_supply_kind CHECK (supply_kind IS NULL OR supply_kind IN ('inventory','expense'));
COMMENT ON COLUMN partner.supply_kind IS '공급자 종류 — inventory(재고 매입처) / expense(비용 업체) / NULL(미분류, 홈택스 매입 수집본은 분류 대기) (0092)';

ALTER TABLE purchase ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE purchase ADD COLUMN IF NOT EXISTS origin_ref TEXT;
ALTER TABLE purchase DROP CONSTRAINT IF EXISTS chk_purchase_origin;
ALTER TABLE purchase ADD CONSTRAINT chk_purchase_origin CHECK (origin IS NULL OR origin IN ('hometax'));
CREATE INDEX IF NOT EXISTS idx_purchase_origin ON purchase(origin) WHERE origin IS NOT NULL AND deleted_at IS NULL;
COMMENT ON COLUMN purchase.origin IS '매입 출처 — hometax(홈택스 수집본에서 자동 생성, 품목 미정일 수 있음) (0092)';
COMMENT ON COLUMN purchase.origin_ref IS '출처 참조 — hometax 면 국세청 승인번호 (0092)';

ALTER TABLE receipt ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE receipt ADD COLUMN IF NOT EXISTS origin_ref TEXT;
ALTER TABLE receipt DROP CONSTRAINT IF EXISTS chk_receipt_origin;
ALTER TABLE receipt ADD CONSTRAINT chk_receipt_origin CHECK (origin IS NULL OR origin IN ('hometax'));
CREATE INDEX IF NOT EXISTS idx_receipt_origin ON receipt(origin) WHERE origin IS NOT NULL AND deleted_at IS NULL;
COMMENT ON COLUMN receipt.origin IS '비용 출처 — hometax(홈택스 매입 수집본에서 자동 생성) (0092)';

ALTER TABLE hometax_invoice ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES receipt(id);

NOTIFY pgrst, 'reload schema';
