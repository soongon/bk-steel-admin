-- ============================================================
-- 0102_rebar_item_sd500_sd600_9m.sql
-- 철근 SD500 · SD600 9M 품목 추가 — 견적·매출·매입 폼이 9M 도 내게 되면서(8·9·10·12M).
--
-- 0097 과 같은 방식: 1본 중량(weight_per_unit_kg)·1톤 표준본수(bars_per_tonne)는
-- 규격×길이로만 정해지고 강종과 무관 → 같은 규격의 SD400 9M 품목 값을 그대로 복사한다
-- (market_item_id 포함). code/name 패턴도 동일: REBAR_{spec}_{grade}_9M.
-- 멱등 (ON CONFLICT (code) DO NOTHING).
-- ============================================================

INSERT INTO item (
  code, name, category, market_item_id,
  rebar_spec_code, rebar_grade_code, length_m,
  weight_per_unit_kg, bars_per_tonne, is_active
)
SELECT
  'REBAR_' || i.rebar_spec_code || '_' || g.grade || '_' || i.length_m::int || 'M',
  '철근 ' || i.rebar_spec_code || ' ' || g.grade || ' ' || i.length_m::int || 'M',
  'rebar',
  i.market_item_id,
  i.rebar_spec_code,
  g.grade,
  i.length_m,
  i.weight_per_unit_kg,
  i.bars_per_tonne,
  true
FROM item i
CROSS JOIN (VALUES ('SD500'), ('SD600')) AS g(grade)
WHERE i.category = 'rebar'
  AND i.rebar_grade_code = 'SD400'
  AND i.length_m = 9
  AND i.deleted_at IS NULL
ON CONFLICT (code) DO NOTHING;
