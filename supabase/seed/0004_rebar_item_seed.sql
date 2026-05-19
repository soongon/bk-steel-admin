-- ============================================================
-- 0004_rebar_item_seed.sql
-- 이형철근 KS D 3504 기본 품목 시드 — 11 spec × 6 length × SD400 = 66 item.
-- 참조: docs/reference-data/rebar/rebar_weight_table_D10_D25.jpg / _D29_D41.jpg
-- (1톤 단위 출하 환산표 — KS 표준)
--
-- weight_per_unit_kg = rebar_spec.unit_weight_kg_per_m × length_m (1본 중량)
--
-- 운영 중 SD500/SD600 등 다른 grade 추가는 동일 패턴으로 grade 값만 바꿔 재실행.
-- 멱등 (ON CONFLICT DO NOTHING + UPDATE는 NULL weight 보정만).
-- ============================================================

-- 1) 기존 rebar item 중 code 형식이 옛 패턴인 경우 새 패턴으로 통일
--    옛: REBAR_{spec}_{len}M_{grade}  →  새: REBAR_{spec}_{grade}_{len}M
--    (items page actions.ts 의 자동 생성 패턴과 일치)
UPDATE item
SET
  code = 'REBAR_' || rebar_spec_code || '_' || rebar_grade_code || '_' || length_m::int || 'M',
  name = '철근 ' || rebar_spec_code || ' ' || rebar_grade_code || ' ' || length_m::int || 'M'
WHERE category = 'rebar'
  AND deleted_at IS NULL
  AND rebar_spec_code IS NOT NULL
  AND rebar_grade_code IS NOT NULL
  AND length_m IS NOT NULL
  AND code <> 'REBAR_' || rebar_spec_code || '_' || rebar_grade_code || '_' || length_m::int || 'M';

-- 2) 11 spec × 6 length × SD400 일괄 INSERT (멱등)
INSERT INTO item (
  code, name, category, rebar_spec_code, rebar_grade_code, length_m, weight_per_unit_kg, is_active
)
SELECT
  'REBAR_' || rs.spec_code || '_SD400_' || l.len::int || 'M',
  '철근 ' || rs.spec_code || ' SD400 ' || l.len::int || 'M',
  'rebar',
  rs.spec_code,
  'SD400',
  l.len,
  rs.unit_weight_kg_per_m * l.len,
  true
FROM rebar_spec rs
CROSS JOIN (VALUES (6::numeric), (8), (9), (10), (11), (12)) AS l(len)
WHERE rs.spec_code IN ('D10','D13','D16','D19','D22','D25','D29','D32','D35','D38','D41')
ON CONFLICT (code) DO NOTHING;

-- 3) weight_per_unit_kg NULL 보정 (1)에서 rename된 행 중 weight 미입력 case)
UPDATE item AS i
SET weight_per_unit_kg = rs.unit_weight_kg_per_m * i.length_m
FROM rebar_spec rs
WHERE i.category = 'rebar'
  AND i.deleted_at IS NULL
  AND i.rebar_spec_code = rs.spec_code
  AND i.length_m IS NOT NULL
  AND i.weight_per_unit_kg IS NULL;
