-- ============================================================
-- 0039_construction_lifecycle_dates.sql
-- 발주 레이더 — 민간 건축 라이프사이클 날짜 컬럼.
--
-- 영업이 단계별로 다르게 접근(허가=선점 / 착공=납품 / 준공=매입)하므로,
-- 카드에 각 단계 날짜·D-N을 보여주기 위해 4개 날짜를 별도 컬럼으로 둔다.
-- (stage_date는 "현재 단계 기준일" 한 개만 담아 타임라인 표시에 부족.)
-- 관급(nara_bid)은 전부 null.
-- ============================================================

ALTER TABLE construction_project
  ADD COLUMN IF NOT EXISTS permit_date      DATE,  -- 건축허가일 (archPmsDay)   — 선점
  ADD COLUMN IF NOT EXISTS sched_start_date DATE,  -- 착공예정일 (stcnsSchedDay) — 견적(선행)
  ADD COLUMN IF NOT EXISTS start_date       DATE,  -- 실착공일   (realStcnsDay)  — 납품
  ADD COLUMN IF NOT EXISTS completion_date  DATE;  -- 사용승인일 (useAprDay)     — 매입

-- 최근 준공 조회용 (매입 레이더)
CREATE INDEX IF NOT EXISTS idx_cproj_completion
  ON construction_project (completion_date) WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
