-- ============================================================
-- 0103_rebar_custom_length.sql
-- 철근 길이 직접 입력(6.5M 등 공인 길이가 아닌 납품) + 6M 품목 목록 공개.
--
--   1) ensure_rebar_item(규격, 강종, 길이) — 그 규격×강종×길이의 철근 품목을 찾아 주고 없으면 만든다.
--      매출 폼의 '길이 직접 입력'이 저장할 때 부른다(lib/rebar-item resolveCustomRebarItems).
--      · 품목 등록은 owner/manager 만 되므로(p_item_insert) SECURITY DEFINER — 권한은 staff 이상을 직접 검사.
--      · 1본 중량 = 단위중량(kg/m) × 길이. 비공인 길이는 가닥으로만 거래해 1톤 표준본수(bars_per_tonne)가 없다(null).
--        같은 규격×길이의 다른 강종 품목이 있으면(공인 길이) 그 표준본수·시세 품목을 물려받는다(0097 과 같은 근거).
--      · code/name 패턴은 0004 시드·items actions 와 같다: REBAR_{spec}_{grade}_{len}M (6.5M, 6M).
--      · 꺼 둔(is_active=false)·지운 같은 품목은 되살린다 — 폼 목록·명세표가 살아 있는 품목만 읽기 때문.
--   2) SD500 · SD600 6M 품목 — 폼이 6M 도 목록에 내게 되면서(6·8·9·10·12M). 0097·0102 와 같은 방식. 멱등.
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_rebar_item(p_spec text, p_grade text, p_length_m numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_len    numeric(5,2) := round(p_length_m, 2);
  v_label  text;
  v_code   text;
  v_id     uuid;
  v_unit_w numeric;
  v_bpt    integer;
  v_mkt    uuid;
BEGIN
  IF NOT current_user_has_any_staff_role() THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  IF v_len IS NULL OR v_len <= 0 OR v_len > 12 THEN
    RAISE EXCEPTION '철근 길이는 0보다 크고 12m 이하여야 합니다';
  END IF;
  SELECT unit_weight_kg_per_m INTO v_unit_w FROM rebar_spec WHERE spec_code = p_spec;
  IF NOT FOUND THEN
    RAISE EXCEPTION '없는 철근 규격입니다: %', p_spec;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rebar_grade WHERE grade_code = p_grade) THEN
    RAISE EXCEPTION '없는 철근 강종입니다: %', p_grade;
  END IF;

  -- 같은 규격·강종·길이의 살아 있는 품목이 있으면 그것(코드가 달라도).
  SELECT id INTO v_id
    FROM item
   WHERE category = 'rebar'
     AND rebar_spec_code = p_spec
     AND rebar_grade_code = p_grade
     AND length_m = v_len
     AND deleted_at IS NULL
   ORDER BY is_active DESC, created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE item SET is_active = true WHERE id = v_id AND NOT is_active;
    RETURN v_id;
  END IF;

  -- 공인 길이면 같은 규격×길이의 다른 강종(SD400 우선)에서 표준본수·시세 품목을 물려받는다.
  SELECT bars_per_tonne, market_item_id INTO v_bpt, v_mkt
    FROM item
   WHERE category = 'rebar'
     AND rebar_spec_code = p_spec
     AND length_m = v_len
     AND deleted_at IS NULL
     AND bars_per_tonne IS NOT NULL
   ORDER BY (rebar_grade_code = 'SD400') DESC, created_at
   LIMIT 1;

  -- '6.50' → '6.5', '6.00' → '6'
  v_label := trim(trailing '.' from trim(trailing '0' from v_len::text));
  v_code  := 'REBAR_' || upper(regexp_replace(p_spec, '[^A-Za-z0-9]', '', 'g')) || '_' || p_grade || '_' || v_label || 'M';

  INSERT INTO item (
    code, name, category, market_item_id,
    rebar_spec_code, rebar_grade_code, length_m,
    weight_per_unit_kg, bars_per_tonne, is_active
  ) VALUES (
    v_code,
    '철근 ' || p_spec || ' ' || p_grade || ' ' || v_label || 'M',
    'rebar', v_mkt,
    p_spec, p_grade, v_len,
    round(v_unit_w * v_len, 3), v_bpt, true
  )
  -- 같은 코드가 지워진 채 남아 있으면 되살린다.
  ON CONFLICT (code) DO UPDATE
    SET deleted_at = NULL,
        is_active = true,
        name = EXCLUDED.name,
        category = 'rebar',
        rebar_spec_code = EXCLUDED.rebar_spec_code,
        rebar_grade_code = EXCLUDED.rebar_grade_code,
        length_m = EXCLUDED.length_m,
        weight_per_unit_kg = EXCLUDED.weight_per_unit_kg
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
COMMENT ON FUNCTION ensure_rebar_item(text, text, numeric) IS
  '철근 규격×강종×길이 품목을 찾거나 만든다 — 매출 폼 길이 직접 입력(비공인 길이, 가닥 거래)용. staff 이상 (0103)';
REVOKE ALL ON FUNCTION ensure_rebar_item(text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ensure_rebar_item(text, text, numeric) TO authenticated;

-- ---- SD500 · SD600 6M 품목 (같은 규격 SD400 6M 의 본중량·표준본수 복사) ----
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
  AND i.length_m = 6
  AND i.deleted_at IS NULL
ON CONFLICT (code) DO NOTHING;
