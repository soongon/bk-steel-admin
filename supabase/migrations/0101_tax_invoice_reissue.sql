-- ============================================================
-- 0101_tax_invoice_reissue.sql
-- 계산서 발행취소 → 매출 품목 수정 → 다시 발행 (사장 요청 2026-11-07: 발행 뒤 추가 주문이 오면 취소하고 다시 발행).
--   · 앱은 다시 발행할 때 새 문서관리번호(`{book}-{doc_no}-2` …)를 쓴다 — 팝빌이 취소된 문서의 번호를 계속 쥐고 있고,
--     uq_tax_invoice_mgt_key(0057)도 취소된 기록을 센다.
--   · record_sale_tax_invoice(0094 판)는 같은 번호의 행이 있으면 UPDATE 하는데, 그 행이 발행취소된 기록이면
--     상태만 '발행됨'으로 되살아나고 금액·품목·공급받는자·비고([취소: …])는 옛 값으로 남았다. 이제 거부한다.
--     나머지는 0094 와 같다(같은 번호 재기록 = 상태 동기화 멱등, 다른 매출의 행이면 거부).
-- ============================================================

CREATE OR REPLACE FUNCTION record_sale_tax_invoice(p_sale_id uuid, p_invoice jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_book  book_type;
  v_mgt   text := p_invoice->>'mgt_key';
  v_state tax_invoice_state := COALESCE((p_invoice->>'state')::tax_invoice_state, 'issued');
  v_write date := (p_invoice->>'write_date')::date;
  v_nts   text := NULLIF(p_invoice->>'nts_confirm_num', '');
  v_issued boolean;
  v_id    uuid;
  v_owner uuid;
  v_prev_state tax_invoice_state;
BEGIN
  SELECT book INTO v_book FROM sale WHERE id = p_sale_id AND deleted_at IS NULL;
  IF v_book IS NULL THEN RAISE EXCEPTION '매출을 찾을 수 없습니다'; END IF;
  IF v_book = 'b' THEN RAISE EXCEPTION 'B계좌는 세금계산서를 발행할 수 없습니다'; END IF;
  IF v_mgt IS NULL OR v_mgt = '' THEN RAISE EXCEPTION '문서관리번호(mgt_key)가 필요합니다'; END IF;

  v_issued := v_state IN ('issued','nts_sent','nts_approved');

  SELECT id, sale_id, state INTO v_id, v_owner, v_prev_state FROM tax_invoice
    WHERE book = v_book AND mgt_key = v_mgt AND deleted_at IS NULL;
  -- 같은 관리번호의 기록이 다른 매출(지운 매출 포함)에 있으면 그 행을 고쳐 쓰지 않는다 — 이 매출엔 기록 없이
  -- 발행 표시만 생기는 어긋남을 막는다(0094).
  IF v_id IS NOT NULL AND v_owner <> p_sale_id THEN
    RAISE EXCEPTION '같은 관리번호(%)의 계산서 기록이 다른 매출에 연결돼 있습니다', v_mgt;
  END IF;
  -- 발행취소된 기록을 같은 번호로 되살리지 않는다 — 상태만 바뀌고 금액·품목·공급받는자는 옛 값으로 남는다(0101).
  -- 다시 발행할 때는 앱이 새 번호(`{book}-{doc_no}-2` …)를 고른다.
  IF v_id IS NOT NULL AND v_prev_state = 'cancelled' THEN
    RAISE EXCEPTION '발행취소된 계산서와 같은 관리번호(%)입니다 — 새로고침한 뒤 다시 발행하세요', v_mgt;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO tax_invoice (
      book, sale_id, provider, mgt_key, nts_confirm_num, state, purpose, write_date,
      supplier, buyer, lines, supply_krw, vat_krw, total_krw, item_summary, remark,
      asp_response, issued_at
    ) VALUES (
      v_book, p_sale_id, COALESCE(p_invoice->>'provider','popbill'), v_mgt, v_nts, v_state,
      COALESCE(NULLIF(p_invoice->>'purpose',''),'charge'), v_write,
      COALESCE(p_invoice->'supplier','{}'::jsonb), COALESCE(p_invoice->'buyer','{}'::jsonb),
      COALESCE(p_invoice->'lines','[]'::jsonb),
      COALESCE((p_invoice->>'supply_krw')::numeric, 0),
      COALESCE((p_invoice->>'vat_krw')::numeric, 0),
      COALESCE((p_invoice->>'total_krw')::numeric, 0),
      NULLIF(p_invoice->>'item_summary',''), NULLIF(p_invoice->>'remark',''),
      p_invoice->'asp_response',
      CASE WHEN v_issued THEN NOW() ELSE NULL END
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE tax_invoice SET
      state           = v_state,
      nts_confirm_num = COALESCE(v_nts, nts_confirm_num),
      asp_response    = COALESCE(p_invoice->'asp_response', asp_response),
      issued_at       = COALESCE(issued_at, CASE WHEN v_issued THEN NOW() ELSE NULL END)
    WHERE id = v_id;
  END IF;

  IF v_issued THEN
    UPDATE sale SET
      tax_invoice_issued_on = v_write,
      tax_doc_no            = COALESCE(v_nts, tax_doc_no)
    WHERE id = p_sale_id AND deleted_at IS NULL;
  END IF;

  RETURN v_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
