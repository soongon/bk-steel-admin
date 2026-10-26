-- ============================================================
-- 0087_sale_origin.sql
-- 매출 출처 표시 — 홈택스 수집본(직접 발행 계산서)에서 자동 생성된 매출을 목록·상세에서 식별한다(사장 결정 2026-10-26).
--   · origin = 'hometax' : docs/홈택스_계산서_수집_연동_기획.md §14. 계산서 작성일을 주문·납품일로, 금액 라인 1줄(철제 직접입력, 중량 없음)로
--     만들어지므로 "품목 미정"(재고 미반영) 상태일 수 있다 → 수정 기능으로 품목·현장을 채운다.
--   · origin_ref = 국세청 승인번호(정규화: 하이픈 없음·소문자).
--   · create_sale_with_lines 는 이 컬럼을 받지 않는다 — 생성 직후 UPDATE 로 기록(RLS staff / 서비스 롤).
-- ============================================================

ALTER TABLE sale ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE sale ADD COLUMN IF NOT EXISTS origin_ref TEXT;
ALTER TABLE sale DROP CONSTRAINT IF EXISTS chk_sale_origin;
ALTER TABLE sale ADD CONSTRAINT chk_sale_origin CHECK (origin IS NULL OR origin IN ('hometax'));
CREATE INDEX IF NOT EXISTS idx_sale_origin ON sale(origin) WHERE origin IS NOT NULL AND deleted_at IS NULL;
COMMENT ON COLUMN sale.origin IS '매출 출처 — hometax(홈택스 수집본에서 자동 생성, 품목 미정일 수 있음). NULL=직접 등록 (0087)';
COMMENT ON COLUMN sale.origin_ref IS '출처 참조 — hometax 면 국세청 승인번호 (0087)';

NOTIFY pgrst, 'reload schema';
