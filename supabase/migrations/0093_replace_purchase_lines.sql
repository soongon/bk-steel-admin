-- ============================================================
-- 0093_replace_purchase_lines.sql
-- 매입 수정에서 품목 라인을 추가·삭제·수정 — 라인 전체 교체 RPC (기획 §15 ③, 매출 0089 의 매입판).
--   · 홈택스 매입 수집본으로 자동 생성된 매입(purchase.origin='hometax', 0092)은 금액 라인 1줄(철제 직접입력, 수량 1 ea,
--     중량 없음 = '품목 미정')뿐이라, 실제 품목·실중량(kg)·현장을 수정에서 채워야 재고(vw_inventory = purchase_line 중량)에
--     잡힌다. 헤더(입고일·상태·현장 등)는 기존대로 앱(updatePurchaseHeader)이 바꾼다.
--   · 라인 전체 교체(delete→insert). 매입 라인은 재고의 원천이라 아래 이력이 걸린 매입은 교체를 거부한다:
--       - sale_line_allocation(출고 배분, FK ON DELETE 없음) · inventory_adjustment.source_purchase_line_id(가공 원본)
--       - purchase_line.parent_purchase_line_id(절단/분할 자식) · created_by_adjustment_id(가공 결과 라인)
--     (5월 마이그레이션 데이터만 해당 — 시스템에서 만든 매입은 전부 교체 가능.)
--   · 창고·존은 기존 라인의 값을 그대로 잇고, 없으면 WH-MAIN + 책 우선 존.
--   · 가드:
--       - 라인 비면 불가. kg 단위는 실중량 필수(chk_kg_unit_actual_required 와 같은 뜻, 메시지만 친절하게).
--         가닥(ea/piece/bundle) 단위는 가닥수 없으면 수량으로 채운다(철제 ea 라인이 chk_bars_count_required 에 걸리던 문제).
--       - 홈택스 수집본과 연결된 매입(hometax_invoice.purchase_id)은 p_recalc 와 무관하게 새 라인 공급가액 합 = purchase.subtotal_krw
--         이어야 한다(다르면 '홈택스 계산서 금액과 다릅니다'). 합계는 그대로 — 국세청 계산서가 기준.
--       - 연결이 없고 p_recalc 이면 subtotal/vat/total 을 라인 합으로 재계산(lib/transaction computeVat 와 같은 규칙).
--       - 연결이 없고 p_recalc=false 면 라인 합 = 기존 공급가액이어야 한다(합계 고정).
--       - 결제완료(paid_on) 매입은 합계가 바뀌면 거부(통장 출금 기록과 어긋남).
--   · 권한: RLS 의 purchase_line DELETE 정책은 manager 이상(0019)이라 SECURITY INVOKER 로는 staff 가 라인을 지울 수 없다
--     (RLS 는 오류 없이 0건 삭제 → 라인 중복). 그래서 SECURITY DEFINER + current_user_has_book_role(book,'staff') 를
--     함수 안에서 직접 검사한다(책 격리·B계좌 격리는 그 검사로 유지). authenticated 만 EXECUTE.
--   · 0015 단가 자동 누적 트리거(AFTER INSERT)는 ON CONFLICT DO NOTHING 이라 재삽입에 안전. 0017 감사 트리거가 전후를 남긴다.
-- p_lines = [{ item_id, acquired_unit, acquired_qty, unit_price_krw, bars_count|null, theoretical_weight_kg|null,
--              actual_weight_kg|null, line_subtotal_krw, notes|null }, ...]
-- ============================================================

CREATE OR REPLACE FUNCTION replace_purchase_lines(
  p_purchase_id uuid,
  p_lines       jsonb,
  p_recalc      boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pur         purchase%ROWTYPE;
  v_line        jsonb;
  v_sum         numeric := 0;
  v_fixed       boolean;
  v_vat_type    vat_type;
  v_vat_rate    numeric;
  v_vat         numeric;
  v_total       numeric;
  v_wh          uuid;
  v_zone        uuid;
  v_unit        acquired_unit;
  v_qty         numeric;
  v_actual      numeric;
  v_theo        numeric;
  v_bars        int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;

  SELECT * INTO v_pur FROM purchase WHERE id = p_purchase_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '매입을 찾을 수 없습니다';
  END IF;
  IF NOT current_user_has_book_role(v_pur.book, 'staff') THEN
    RAISE EXCEPTION '권한이 없습니다 (staff 이상 필요)';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '매입 품목 라인이 비어 있습니다';
  END IF;

  -- 재고 이력이 걸린 라인이 있으면 교체 불가(출고 배분·가공·절단).
  IF EXISTS (
    SELECT 1 FROM purchase_line pl
     WHERE pl.purchase_id = p_purchase_id
       AND (
         EXISTS (SELECT 1 FROM sale_line_allocation a WHERE a.purchase_line_id = pl.id)
         OR EXISTS (SELECT 1 FROM inventory_adjustment ia WHERE ia.source_purchase_line_id = pl.id)
         OR EXISTS (SELECT 1 FROM purchase_line c WHERE c.parent_purchase_line_id = pl.id)
         OR pl.created_by_adjustment_id IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION '출고 배분·가공 이력이 있는 매입은 품목을 수정할 수 없습니다';
  END IF;

  -- 라인 검증 + 공급가액 합. 조정 라인(계산서 금액 맞춤)은 음수 금액이 가능하므로 금액 부호는 제한하지 않는다.
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    IF NULLIF(v_line->>'item_id', '') IS NULL THEN
      RAISE EXCEPTION '품목이 없는 라인이 있습니다';
    END IF;
    IF NULLIF(v_line->>'acquired_unit', '') IS NULL THEN
      RAISE EXCEPTION '단위가 없는 라인이 있습니다';
    END IF;
    IF COALESCE((v_line->>'acquired_qty')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION '수량은 0보다 커야 합니다';
    END IF;
    IF (v_line->>'acquired_unit') = 'kg' AND NULLIF(v_line->>'actual_weight_kg', '') IS NULL THEN
      RAISE EXCEPTION 'kg 단위 매입은 실중량이 필수입니다';
    END IF;
    IF NULLIF(v_line->>'line_subtotal_krw', '') IS NULL THEN
      RAISE EXCEPTION '라인 공급가액이 없습니다';
    END IF;
    v_sum := v_sum + (v_line->>'line_subtotal_krw')::numeric;
  END LOOP;

  -- 홈택스 수집본과 연결된 매입 — 국세청 계산서 금액이 기준(합계 고정).
  SELECT EXISTS (
    SELECT 1 FROM hometax_invoice h WHERE h.purchase_id = p_purchase_id
  ) INTO v_fixed;

  IF v_fixed THEN
    IF v_sum <> v_pur.subtotal_krw THEN
      RAISE EXCEPTION '홈택스 계산서 금액과 다릅니다 (라인 합 %, 계산서 공급가액 %)', v_sum, v_pur.subtotal_krw;
    END IF;
  ELSIF p_recalc THEN
    v_vat_type := CASE
      WHEN NOT v_pur.is_documented OR v_pur.tax_doc_type = 'none' THEN 'non_taxable'::vat_type
      WHEN v_pur.tax_doc_type = 'invoice' THEN 'exempt'::vat_type
      ELSE 'standard_10'::vat_type
    END;
    v_vat_rate := CASE WHEN v_vat_type = 'standard_10' THEN 10 ELSE 0 END;
    v_vat      := CASE WHEN v_vat_rate > 0 THEN round(v_sum * v_vat_rate / 100) ELSE 0 END;
    v_total    := v_sum + v_vat;

    IF v_pur.paid_on IS NOT NULL AND (v_sum <> v_pur.subtotal_krw OR v_total <> v_pur.total_krw) THEN
      RAISE EXCEPTION '결제완료된 매입은 합계를 바꿀 수 없습니다 (라인 합 %, 현재 공급가액 %)', v_sum, v_pur.subtotal_krw;
    END IF;

    UPDATE purchase SET
      vat_type     = v_vat_type,
      vat_rate     = v_vat_rate,
      subtotal_krw = v_sum,
      vat_krw      = v_vat,
      total_krw    = v_total
    WHERE id = p_purchase_id;
  ELSE
    IF v_sum <> v_pur.subtotal_krw THEN
      RAISE EXCEPTION '라인 합이 매입 공급가액과 다릅니다 (라인 합 %, 공급가액 %)', v_sum, v_pur.subtotal_krw;
    END IF;
  END IF;

  -- 창고·존: 기존 라인 값을 잇고, 없으면 WH-MAIN + 책 우선 존.
  SELECT warehouse_id, warehouse_zone_id INTO v_wh, v_zone
    FROM purchase_line WHERE purchase_id = p_purchase_id ORDER BY created_at LIMIT 1;
  IF v_wh IS NULL THEN
    SELECT id INTO v_wh FROM warehouse WHERE code = 'WH-MAIN' AND deleted_at IS NULL LIMIT 1;
    IF v_wh IS NULL THEN
      RAISE EXCEPTION '기본 창고(WH-MAIN)가 없습니다';
    END IF;
    SELECT id INTO v_zone FROM warehouse_zone WHERE warehouse_id = v_wh AND preferred_book = v_pur.book LIMIT 1;
  END IF;

  -- 라인 전체 교체. 라인 상태는 헤더 상태와 일치.
  DELETE FROM purchase_line WHERE purchase_id = p_purchase_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_unit   := (v_line->>'acquired_unit')::acquired_unit;
    v_qty    := (v_line->>'acquired_qty')::numeric;
    v_actual := NULLIF(v_line->>'actual_weight_kg', '')::numeric;
    v_theo   := NULLIF(v_line->>'theoretical_weight_kg', '')::numeric;
    v_bars   := NULLIF(v_line->>'bars_count', '')::int;
    IF v_bars IS NULL AND v_unit IN ('ea', 'piece', 'bundle') THEN
      v_bars := round(v_qty)::int; -- 철제 등 가닥수 없는 ea 라인은 수량을 가닥수로
    END IF;

    INSERT INTO purchase_line (
      purchase_id, book, warehouse_id, warehouse_zone_id, item_id,
      acquired_unit, acquired_qty, unit_price_krw, bars_count,
      theoretical_weight_kg, actual_weight_kg, invoiced_weight_kg,
      price_basis, line_subtotal_krw, status, notes
    ) VALUES (
      p_purchase_id,
      v_pur.book,
      v_wh,
      v_zone,
      (v_line->>'item_id')::uuid,
      v_unit,
      v_qty,
      COALESCE((v_line->>'unit_price_krw')::numeric, 0),
      v_bars,
      v_theo,
      v_actual,
      COALESCE(v_actual, v_theo),
      CASE WHEN v_unit = 'kg' THEN 'actual'::price_basis ELSE 'theoretical'::price_basis END,
      (v_line->>'line_subtotal_krw')::numeric,
      v_pur.status,
      NULLIF(v_line->>'notes', '')
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION replace_purchase_lines(uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_purchase_lines(uuid, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION replace_purchase_lines(uuid, jsonb, boolean) IS
  '매입 품목 라인 전체 교체(수정). 홈택스 수집본 연결 시 라인 합=계산서 공급가액 강제, 없으면 합계 재계산. 결제완료·재고 이력 가드 (0093)';

NOTIFY pgrst, 'reload schema';
