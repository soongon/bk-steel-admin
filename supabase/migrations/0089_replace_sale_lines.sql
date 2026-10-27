-- ============================================================
-- 0089_replace_sale_lines.sql
-- 매출 수정에서 품목 라인을 추가·삭제·수정 — 라인 전체 교체 RPC (사장 결정 2026-10-26, 기획 §14 ②).
--   · 홈택스 직접 발행 계산서로 자동 생성된 매출(sale.origin='hometax', 0087)은 금액 라인 1줄(철제 직접입력, 중량 없음 =
--     '품목 미정')뿐이라, 실제 품목·중량(kg)·현장을 수정에서 채워야 한다. 0056 에서 철회한 update_sale_with_lines(0055)를
--     "라인만 교체 + 합계 가드" 로 다시 들인다. 헤더(일자·상태·현장 등)는 기존대로 앱(updateSaleHeader)이 바꾼다.
--   · 라인 전체 교체(delete→insert). sale_line_allocation 은 ON DELETE CASCADE(0009)이고 실제로 어디서도 쓰지 않는다
--     (재고는 뷰 계산) → 라인 교체는 재고 정합에 안전(0055 주석과 같은 설명). INSERT 컬럼은 create_sale_with_lines(0064)와 동일
--     + notes(조정 라인 사유).
--   · 가드:
--       - 취소 매출 불가, 라인 비면 불가.
--       - 활성 발행 기록(tax_invoice, state<>cancelled)이 있으면 p_recalc 와 무관하게 새 라인 공급가액 합 = sale.subtotal_krw
--         이어야 한다(다르면 '발행된 계산서 금액과 다릅니다'). 합계(subtotal/vat/total)는 그대로 — 계산서가 기준.
--       - 발행 기록이 없고 p_recalc 이면 subtotal/vat/total 을 라인 합으로 재계산. vat_type 규칙은 lib/transaction computeVat 와
--         동일: 무자료 또는 tax_doc_type='none' → non_taxable(0%), 'invoice'(계산서) → exempt(0%), 그 외 → standard_10(10%).
--       - 발행 기록이 없고 p_recalc=false 면 라인 합 = 기존 공급가액이어야 한다(합계 고정).
--       - 수금완료(settled) 매출은 합계가 바뀌면 거부(통장 입금 기록과 어긋남).
--   · 권한: RLS 의 sale_line DELETE 정책은 manager 이상(0019)이라 SECURITY INVOKER 로는 staff 가 라인을 지울 수 없다
--     (RLS 는 오류 없이 0건 삭제 → 라인 중복 위험). 그래서 SECURITY DEFINER + current_user_has_book_role(book,'staff') 를
--     함수 안에서 직접 검사한다(책 격리·B계좌 격리는 그 검사로 유지). authenticated 만 EXECUTE.
-- p_lines = [{ item_id, unit, qty, unit_price_krw, weight_kg|null, line_subtotal_krw, display_name|null, spec_text|null, notes|null }, ...]
-- ============================================================

CREATE OR REPLACE FUNCTION replace_sale_lines(
  p_sale_id uuid,
  p_lines   jsonb,
  p_recalc  boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale        sale%ROWTYPE;
  v_line        jsonb;
  v_sum         numeric := 0;
  v_has_invoice boolean;
  v_vat_type    vat_type;
  v_vat_rate    numeric;
  v_vat         numeric;
  v_total       numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;

  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '매출을 찾을 수 없습니다';
  END IF;
  IF NOT current_user_has_book_role(v_sale.book, 'staff') THEN
    RAISE EXCEPTION '권한이 없습니다 (staff 이상 필요)';
  END IF;
  IF v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION '취소된 매출의 품목은 수정할 수 없습니다';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '매출 품목 라인이 비어 있습니다';
  END IF;

  -- 라인 검증 + 공급가액 합. 조정 라인(계산서 금액 맞춤)은 음수 금액이 가능하므로 금액 부호는 제한하지 않는다.
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    IF NULLIF(v_line->>'item_id', '') IS NULL THEN
      RAISE EXCEPTION '품목이 없는 라인이 있습니다';
    END IF;
    IF COALESCE((v_line->>'qty')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION '수량은 0보다 커야 합니다';
    END IF;
    IF NULLIF(v_line->>'line_subtotal_krw', '') IS NULL THEN
      RAISE EXCEPTION '라인 공급가액이 없습니다';
    END IF;
    v_sum := v_sum + (v_line->>'line_subtotal_krw')::numeric;
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM tax_invoice
     WHERE sale_id = p_sale_id AND deleted_at IS NULL AND state <> 'cancelled'
  ) INTO v_has_invoice;

  IF v_has_invoice THEN
    -- 발행된 계산서가 기준 — 라인 합이 계산서(=현재 헤더) 공급가액과 같아야 하고 합계는 건드리지 않는다.
    IF v_sum <> v_sale.subtotal_krw THEN
      RAISE EXCEPTION '발행된 계산서 금액과 다릅니다 (라인 합 %, 계산서 공급가액 %)', v_sum, v_sale.subtotal_krw;
    END IF;
  ELSIF p_recalc THEN
    -- computeVat 와 동일 규칙으로 vat_type·세액·합계 재계산.
    v_vat_type := CASE
      WHEN NOT v_sale.is_documented OR v_sale.tax_doc_type = 'none' THEN 'non_taxable'::vat_type
      WHEN v_sale.tax_doc_type = 'invoice' THEN 'exempt'::vat_type
      ELSE 'standard_10'::vat_type
    END;
    v_vat_rate := CASE WHEN v_vat_type = 'standard_10' THEN 10 ELSE 0 END;
    v_vat      := CASE WHEN v_vat_rate > 0 THEN round(v_sum * v_vat_rate / 100) ELSE 0 END;
    v_total    := v_sum + v_vat;

    IF v_sale.status = 'settled' AND (v_sum <> v_sale.subtotal_krw OR v_total <> v_sale.total_krw) THEN
      RAISE EXCEPTION '수금완료된 매출은 합계를 바꿀 수 없습니다 (라인 합 %, 현재 공급가액 %)', v_sum, v_sale.subtotal_krw;
    END IF;

    UPDATE sale SET
      vat_type     = v_vat_type,
      vat_rate     = v_vat_rate,
      subtotal_krw = v_sum,
      vat_krw      = v_vat,
      total_krw    = v_total
    WHERE id = p_sale_id;
  ELSE
    -- 합계 고정 모드 — 라인 합이 기존 공급가액과 같아야 한다.
    IF v_sum <> v_sale.subtotal_krw THEN
      RAISE EXCEPTION '라인 합이 매출 공급가액과 다릅니다 (라인 합 %, 공급가액 %)', v_sum, v_sale.subtotal_krw;
    END IF;
  END IF;

  -- 라인 전체 교체. allocation 은 CASCADE 로 정리, 라인 상태는 헤더 상태와 일치.
  DELETE FROM sale_line WHERE sale_id = p_sale_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO sale_line (
      sale_id, book, item_id, unit, qty, unit_price_krw,
      weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, status, display_name, spec_text, notes
    ) VALUES (
      p_sale_id,
      v_sale.book,
      (v_line->>'item_id')::uuid,
      (v_line->>'unit')::acquired_unit,
      (v_line->>'qty')::numeric,
      COALESCE((v_line->>'unit_price_krw')::numeric, 0),
      NULLIF(v_line->>'weight_kg','')::numeric,
      NULLIF(v_line->>'weight_kg','')::numeric,
      'theoretical',
      (v_line->>'line_subtotal_krw')::numeric,
      v_sale.status,
      NULLIF(v_line->>'display_name',''),
      NULLIF(v_line->>'spec_text',''),
      NULLIF(v_line->>'notes','')
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION replace_sale_lines(uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_sale_lines(uuid, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION replace_sale_lines(uuid, jsonb, boolean) IS
  '매출 품목 라인 전체 교체(수정). 발행 기록 있으면 라인 합=계산서 공급가액 강제, 없으면 합계 재계산. 취소·수금완료 가드 (0089)';

NOTIFY pgrst, 'reload schema';
