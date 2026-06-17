-- ============================================================
-- 0056_sale_line_display_name.sql
-- 거래명세표 '품목명' 라벨 오버라이드 — 보통 '철근'으로 표기되지만 거래처가
-- '철근(현대철강)' 식 표기를 요청하는 경우 라인별로 명세표 표시명만 덮어쓴다.
-- null 이면 기본(철근 라벨 / 품목명). 금액·수량·재고·상태와 무관한 순수 표시 필드.
--
-- 더불어 미사용 함수 update_sale_with_lines(0055) 철회 — 매출 품목 qty/단가 수정
-- 기능은 취소되었고(품목명만 수정), 호출처도 제거되어 함수는 더 이상 쓰이지 않는다.
-- ============================================================

DROP FUNCTION IF EXISTS update_sale_with_lines(uuid, jsonb, jsonb);

ALTER TABLE sale_line ADD COLUMN IF NOT EXISTS display_name text;
COMMENT ON COLUMN sale_line.display_name IS
  '거래명세표 품목명 라벨 오버라이드(예: 철근→철근(현대철강)). null이면 기본(철근/품목명).';

-- 라인별 표시명만 갱신(수량·단가·금액·상태 불변). p_sale_id 로 스코프, 권한은 RLS(staff)로 강제.
-- p_updates = [{ "id": <sale_line uuid>, "display_name": <text|null> }, ...]
CREATE OR REPLACE FUNCTION set_sale_line_display_names(p_sale_id uuid, p_updates jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_u jsonb;
BEGIN
  FOR v_u IN SELECT jsonb_array_elements(p_updates) LOOP
    UPDATE sale_line
      SET display_name = NULLIF(btrim(COALESCE(v_u->>'display_name', '')), '')
      WHERE id = (v_u->>'id')::uuid
        AND sale_id = p_sale_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION set_sale_line_display_names(uuid, jsonb) TO authenticated;
