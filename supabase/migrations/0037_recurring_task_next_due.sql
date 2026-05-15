-- ============================================================
-- 0037_recurring_task_next_due.sql
-- recurring_task 에 캘린더 anchor용 next_due_date 컬럼 추가.
-- 사용자가 최초 설정 → 완료 체크하면 cadence 따라 자동 갱신
-- (daily +1d, weekly +7d, monthly +1mo, yearly +1y, adhoc은 변경 없음 — 수동 재설정).
-- ============================================================

ALTER TABLE recurring_task
  ADD COLUMN IF NOT EXISTS next_due_date DATE;

CREATE INDEX IF NOT EXISTS idx_recurring_task_next_due
  ON recurring_task(next_due_date)
  WHERE is_active = TRUE AND next_due_date IS NOT NULL;

NOTIFY pgrst, 'reload schema';
