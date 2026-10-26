-- ============================================================
-- 0086_sale_invoice_adjustment.sql
-- 매출 금액을 홈택스 계산서 금액에 맞추는 유일한 통로 — "조정 라인 추가 + 합계 갱신" (기획 §3.1 X 케이스, 사장 결정 2026-10-26:
-- 홈택스 실제 발행 금액이 맞다고 보고 시스템을 그 금액으로 바꾸고 메모만 남긴다).
--   · 매출 품목 라인의 수량·단가는 불변(0056 에서 update_sale_with_lines 철회)이라, 기존 라인은 건드리지 않고
--     철제 직접입력(STEEL_CUSTOM) 품목으로 "계산서 금액 맞춤" 라인 1줄을 더해 subtotal/vat/total 을 계산서 값으로 맞춘다.
--     중량 없음 → 재고·할당 무관. 명세표에는 그 한 줄이 보인다(계산서와 같은 금액이 된다).
--   · revert 는 그 조정 라인만 지우고 합계를 되돌린다(스크립트 --rollback 용).
--   · SECURITY INVOKER — 화면에서 부르면 RLS(staff) 가 막고, 스크립트는 서비스 롤.
-- ============================================================

CREATE OR REPLACE FUNCTION adjust_sale_to_invoice(
  p_sale_id uuid,
  p_supply_krw numeric,
  p_vat_krw numeric,
  p_total_krw numeric,
  p_label text DEFAULT '계산서 금액 맞춤'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sale     sale%ROWTYPE;
  v_diff_sup numeric;
  v_line_id  uuid;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '매출을 찾을 수 없습니다'; END IF;
  IF v_sale.status = 'cancelled' THEN RAISE EXCEPTION '취소된 매출은 맞출 수 없습니다'; END IF;
  IF v_sale.book = 'b' THEN RAISE EXCEPTION 'B계좌 매출은 계산서 대상이 아닙니다'; END IF;
  IF p_total_krw <> p_supply_krw + p_vat_krw THEN RAISE EXCEPTION '합계가 공급가액+세액과 다릅니다'; END IF;

  v_diff_sup := p_supply_krw - v_sale.subtotal_krw;
  IF v_diff_sup = 0 AND p_vat_krw = v_sale.vat_krw THEN
    RAISE EXCEPTION '이미 같은 금액입니다';
  END IF;

  INSERT INTO sale_line (
    sale_id, book, item_id, unit, qty, unit_price_krw,
    weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, status, display_name,
    notes
  ) VALUES (
    p_sale_id, v_sale.book, '00000000-0000-0000-0000-0000000057ee', 'ea', 1, v_diff_sup,
    NULL, NULL, 'theoretical', v_diff_sup, v_sale.status, p_label,
    format('홈택스 계산서 금액 맞춤: 공급가액 %s → %s, 세액 %s → %s', v_sale.subtotal_krw, p_supply_krw, v_sale.vat_krw, p_vat_krw)
  )
  RETURNING id INTO v_line_id;

  UPDATE sale SET subtotal_krw = p_supply_krw, vat_krw = p_vat_krw, total_krw = p_total_krw
  WHERE id = p_sale_id;

  RETURN v_line_id;
END;
$$;
GRANT EXECUTE ON FUNCTION adjust_sale_to_invoice(uuid, numeric, numeric, numeric, text) TO authenticated;

-- 되돌리기 — adjust 가 만든 조정 라인만 지우고 합계를 이전 값으로. 이전 값은 호출자가 작업 내역에서 넘긴다.
CREATE OR REPLACE FUNCTION revert_sale_invoice_adjustment(
  p_sale_id uuid,
  p_line_id uuid,
  p_prev_supply_krw numeric,
  p_prev_vat_krw numeric,
  p_prev_total_krw numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cnt int;
BEGIN
  DELETE FROM sale_line
   WHERE id = p_line_id AND sale_id = p_sale_id
     AND item_id = '00000000-0000-0000-0000-0000000057ee'
     AND weight_kg IS NULL;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN RAISE EXCEPTION '조정 라인을 찾을 수 없습니다(이미 되돌렸거나 다른 라인)'; END IF;
  UPDATE sale SET subtotal_krw = p_prev_supply_krw, vat_krw = p_prev_vat_krw, total_krw = p_prev_total_krw
  WHERE id = p_sale_id AND deleted_at IS NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION revert_sale_invoice_adjustment(uuid, uuid, numeric, numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
