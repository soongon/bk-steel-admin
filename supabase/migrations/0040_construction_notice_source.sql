-- ============================================================
-- 0040_construction_notice_source.sql
-- 발주 레이더 — 시청 고시(notice) 소스 추가.
--
-- 시청 고시·공고 게시판 스크랩 = "대형 개발 선점 레이더"(산업단지·물류단지·정비사업·
-- 대형건축 심의·개발행위). 착공 스트림이 아니라, 가장 이른 대형 철근 수요 신호.
-- 별도 stage 'notice', source 'notice'. 고시 게시일을 stage_date에 저장(날짜 핵심).
-- source_url = 고시 원문 링크.
-- ============================================================

ALTER TABLE construction_project DROP CONSTRAINT IF EXISTS construction_project_source_check;
ALTER TABLE construction_project ADD CONSTRAINT construction_project_source_check
  CHECK (source IN ('building_permit', 'nara_bid', 'notice'));

ALTER TABLE construction_project DROP CONSTRAINT IF EXISTS construction_project_stage_check;
ALTER TABLE construction_project ADD CONSTRAINT construction_project_stage_check
  CHECK (stage IN ('permit', 'construction_start', 'completed', 'bid_notice', 'awarded', 'notice'));

ALTER TABLE construction_project ADD COLUMN IF NOT EXISTS source_url TEXT; -- 고시/공고 원문 링크

NOTIFY pgrst, 'reload schema';
