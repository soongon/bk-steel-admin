-- ============================================================
-- 0002_rebar_grade.sql — KS D 3504 철근 강종 시드
-- 참조: docs/철근_제품마스터.md §1
-- ============================================================

INSERT INTO rebar_grade (grade_code, yield_strength_mpa, category, display_order) VALUES
  ('SD300',  300, '일반용',      1),
  ('SD400',  400, '일반용',      2),
  ('SD500',  500, '일반용',      3),
  ('SD600',  600, '일반용',      4),
  ('SD700',  700, '일반용',      5),
  ('SD400W', 400, '용접용',      6),
  ('SD500W', 500, '용접용',      7),
  ('SD400S', 400, '특수내진용',  8),
  ('SD500S', 500, '특수내진용',  9),
  ('SD600S', 600, '특수내진용', 10)
ON CONFLICT (grade_code) DO UPDATE SET
  yield_strength_mpa = EXCLUDED.yield_strength_mpa,
  category           = EXCLUDED.category,
  display_order      = EXCLUDED.display_order;
