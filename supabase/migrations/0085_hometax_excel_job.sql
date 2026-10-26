-- ============================================================
-- 0085_hometax_excel_job.sql
-- 홈택스 수집본 "엑셀 입구" + 작업 단위 롤백 (기획 §10·§11: 팝빌 API(월 15만) 대신 팝빌 사이트 엑셀을 주 입구로).
--   · hometax_collection_job.source 에 'excel' 허용, state 에 'rolled_back' 추가, 파일명·수행 내역(details) 보관.
--     details = { actions: [...] } — 이 작업이 쓴 것(수집본 insert/상태 변경, 발행 기록 생성, 메모, 거래처 사업자번호 채움)과
--     이전 값을 전부 남겨 scripts/hometax-excel.ts --rollback <jobId> 가 거꾸로 되돌린다. 운영 DB 하나뿐이라 필수.
--   · hometax_invoice.collection_job_id — 이 행을 처음 넣은 작업. 롤백 시 삭제 대상 식별.
-- ============================================================

ALTER TABLE hometax_collection_job DROP CONSTRAINT IF EXISTS chk_htj_source;
ALTER TABLE hometax_collection_job ADD CONSTRAINT chk_htj_source CHECK (source IN ('cron','manual','excel'));
ALTER TABLE hometax_collection_job DROP CONSTRAINT IF EXISTS chk_htj_state;
ALTER TABLE hometax_collection_job ADD CONSTRAINT chk_htj_state CHECK (state IN ('requested','running','done','failed','rolled_back'));
ALTER TABLE hometax_collection_job ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE hometax_collection_job ADD COLUMN IF NOT EXISTS details JSONB;
ALTER TABLE hometax_collection_job ADD COLUMN IF NOT EXISTS rolled_back_at TIMESTAMPTZ;
COMMENT ON COLUMN hometax_collection_job.details IS '작업이 수행한 쓰기 내역 {actions:[{type,...이전값}]} — 롤백용 (0085)';

ALTER TABLE hometax_invoice ADD COLUMN IF NOT EXISTS collection_job_id UUID REFERENCES hometax_collection_job(id);
CREATE INDEX IF NOT EXISTS idx_hometax_invoice_job ON hometax_invoice(collection_job_id) WHERE collection_job_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
