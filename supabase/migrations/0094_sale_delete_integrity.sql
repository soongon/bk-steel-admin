-- ============================================================
-- 0094_sale_delete_integrity.sql
-- 매출 삭제 — 수금완료 매출도 지울 수 있게 + 지울 때 딸린 데이터 정합 (사용자 요청 2026-10-28).
--   쓰임새: 여러 매출을 하나로 합쳐 계산서를 끊거나, 내용이 바뀐 매출을 새로 만들고 옛 매출을 지운다.
--   지금까지 soft_delete_sale(0047)은 수금완료면 거부했고(수금 취소 기능도 없음), 그 밖의 연결은 손대지 않아
--   국세청 승인 계산서·홈택스 연결·재고 할당이 지운 매출에 남았다.
--
--   1) delete_sale(매출, 수금 처리, 대상 매출, 계산서 처리, 사유, 승인번호) — 한 트랜잭션에서 전부 처리.
--      · 대상 매출 = 합친·새로 만든 매출(같은 책). 옮길 게 없어도 연결 기록(양쪽 메모)·견적 출처용으로 받는다.
--      · 수금 기록(입금, bank_transaction +): 'move' = 대상으로 옮김 — 대상이 납품완료(연체)이고 입금이 합계를 채우면
--        수금완료(마지막 입금의 날짜·통장). 대상이 이미 수금완료면 거부(같은 돈 이중). 'void' = 수금 기록 지움.
--        입금이 있는데 고르지 않으면 거부.
--      · 발행된 세금계산서(issuing·issued·nts_sent·nts_approved) — 국세청 문서라 지우지 않는다.
--        'move' = 대상으로 옮김(같은 거래처, 공급가·세액 같을 때만 — 금액이 다르면 수정세금계산서가 필요).
--        'keep' = 국세청 기록으로 남기고 매출만 삭제 — 세금계산서 화면 '정리 필요'에 뜬다.
--        시스템 밖 발행분(발행 완료 표시만 있고 기록 없음)도 같다 — keep 이면 수기 기록을 남겨 정리 필요·홈택스 대사가 알아본다.
--        draft·failed 는 발행 전이라 취소로 정리. 처리 기록은 계산서 이미지에 찍히는 remark 가 아니라 internal_note 에.
--      · 홈택스 수집본 연결: 계산서를 옮기면 같이 옮기고, 아니면 '무시(매출 삭제)' — 다음 대사에서 매출을 되살리지 않게.
--      · 재고 할당(sale_line_allocation)은 지운다(감사 기록 남음) — 재고로 돌아간다.
--      · 견적 출처: 대상에 비어 있으면 넘기고, 대상 없이 지우면(다른 산 매출도 없으면) 견적을 발송 상태로 되돌린다(다시 전환 가능).
--      · 책 간 이관 매출·어음 연결 매출은 거부. 권한은 그 책 manager 이상.
--      · SECURITY DEFINER(0089 패턴) — 라인 책이 헤더와 어긋나도 RLS 에 걸려 조용히 덜 지우는 일이 없게. 책 권한은 직접 검사.
--   2) soft_delete_sale 은 delete_sale 로 위임(선택 없이 — 입금·발행 계산서가 있으면 고르라고 거부).
--   3) 매출 트리거: 삭제·복구(deleted_at)는 delete_sale 로만, 입금이 붙은 매출은 취소 불가(옮겨 온 수금이 취소 매출에 숨지 않게).
--      하드 DELETE 정책(p_sale_delete)은 없앤다(서비스 롤 스크립트 — 홈택스 되돌리기 — 는 RLS 밖이라 그대로).
--   4) settle_sale_with_payment — 이미 받은 입금(옮겨 온 수금)을 빼고 남은 금액만 입금으로 기록.
--      이미 다 받았으면 새 입금 없이 마지막 입금의 날짜·통장으로 수금완료. 행 잠금·사용 중 통장 검사 추가.
--   5) close_deleted_sale_invoice — 지운 매출에 남긴 계산서 정리: 'modified'(수정세금계산서(−) 발행 — 국세청에 원본이 있으니
--      합계 유지) / 'cancelled'(발행취소 — 합계에서 뺌). 승인번호가 없던 기록은 'modified' 때 원 승인번호(24자리)를 받아 남긴다
--      (홈택스 대사가 번호로 알아보게). 같은 승인번호의 홈택스 수집본은 '무시'로.
--   6) record_sale_tax_invoice — 같은 관리번호의 기록이 다른 매출(지운 매출 포함)에 있으면 거부(옛 행을 고쳐 쓰는 함정).
--   7) vw_inventory — 지운·취소한 매출의 할당은 재고에서 빼지 않는다(손익 원가 뷰와 같은 기준).
--   8) 데이터 정리: 2026-05 이관 통장 거래 4건의 매출·매입 이중 연결, 지운 매출의 살아 있는 라인 1건, 책을 바꾼 매출의 라인 책(10건).
--   9) tax_invoice — internal_note·정리 표시 컬럼, 감사 트리거(내용 없는 저장은 건너뜀), 같은 승인번호(하이픈·대소문자 무시)의
--      활성 기록 중복 금지.
-- ============================================================

-- ------------------------------------------------------------
-- 8) 데이터 정리 (일회성)
-- ------------------------------------------------------------
-- 8-1) 2026-05 이관 때 매출·매입 문서번호(20260507-001·-002)가 겹쳐 통장 거래 4건이 매출·매입에 동시에 연결됐다.
--      입금(+)은 매출에만, 출금(−)은 매입에만 남긴다. vw_receivable(+만)·vw_payable(−만) 결과는 그대로다.
UPDATE bank_transaction SET purchase_id = NULL
 WHERE sale_id IS NOT NULL AND purchase_id IS NOT NULL AND amount_krw > 0;
UPDATE bank_transaction SET sale_id = NULL
 WHERE sale_id IS NOT NULL AND purchase_id IS NOT NULL AND amount_krw < 0;

-- 8-2) 0047 이전에 지운 매출에 남은 살아 있는 라인.
UPDATE sale_line sl SET deleted_at = s.deleted_at
  FROM sale s
 WHERE s.id = sl.sale_id AND s.deleted_at IS NOT NULL AND sl.deleted_at IS NULL;

-- 8-3) 책을 바꾼 매출의 라인 책 — 매출 수정의 책 변경이 헤더만 바꿨다(B계좌 격리: 라인도 매출 책을 따른다).
UPDATE sale_line sl SET book = s.book
  FROM sale s
 WHERE s.id = sl.sale_id AND sl.book <> s.book;

-- ------------------------------------------------------------
-- 9) 세금계산서 — 내부 기록·정리 표시, 감사, 승인번호 중복 금지
-- ------------------------------------------------------------
ALTER TABLE tax_invoice
  ADD COLUMN IF NOT EXISTS internal_note text,
  ADD COLUMN IF NOT EXISTS resolved_at   timestamptz,
  ADD COLUMN IF NOT EXISTS resolution    text,
  ADD COLUMN IF NOT EXISTS resolved_by   uuid;
ALTER TABLE tax_invoice DROP CONSTRAINT IF EXISTS chk_tax_invoice_resolution;
ALTER TABLE tax_invoice ADD CONSTRAINT chk_tax_invoice_resolution
  CHECK (resolution IS NULL OR resolution IN ('modified', 'cancelled'));
COMMENT ON COLUMN tax_invoice.internal_note IS
  '내부 기록(매출 삭제·이관·정리) — 계산서 이미지 비고(remark)에 찍히지 않는다 (0094)';
COMMENT ON COLUMN tax_invoice.resolution IS
  '지운 매출에 남긴 계산서 정리: modified(수정세금계산서(−) 발행 — 합계 유지) · cancelled(발행취소 — state 도 cancelled) (0094)';

-- 같은 국세청 문서를 두 매출에 기록하지 않는다(부가세 합계 이중). 승인번호는 하이픈·대소문자를 빼고 비교하고,
-- 국세청 승인번호 꼴(영문·숫자 24자리)만 — 종이계산서 번호(권·호 등)는 대상이 아니다. 지금 데이터엔 중복 없음.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoice_nts_active
  ON tax_invoice (book, (lower(regexp_replace(nts_confirm_num, '[^0-9A-Za-z]', '', 'g'))))
  WHERE deleted_at IS NULL AND state <> 'cancelled' AND nts_confirm_num IS NOT NULL
    AND length(regexp_replace(nts_confirm_num, '[^0-9A-Za-z]', '', 'g')) = 24;

-- 계산서 이관·정리도 감사 기록에 남긴다(매출·입금과 같은 audit_trigger_fn). 상태 조회가 같은 값으로 다시 저장할 때
-- (updated_at 만 바뀜)는 남기지 않는다.
DROP TRIGGER IF EXISTS trg_audit_tax_invoice ON tax_invoice;
DROP TRIGGER IF EXISTS trg_audit_tax_invoice_update ON tax_invoice;
CREATE TRIGGER trg_audit_tax_invoice
  AFTER INSERT OR DELETE ON tax_invoice
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_tax_invoice_update
  AFTER UPDATE ON tax_invoice
  FOR EACH ROW
  WHEN ((to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
  EXECUTE FUNCTION audit_trigger_fn();

-- ------------------------------------------------------------
-- 7) 재고 — 살아 있는 매출의 할당만 뺀다.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW vw_inventory WITH (security_invoker = true) AS
SELECT
  pl.id                                            AS purchase_line_id,
  pl.book,
  pl.warehouse_id,
  pl.warehouse_zone_id,
  pl.item_id,
  pl.acquired_unit,
  pl.acquired_qty,
  pl.acquired_qty - COALESCE(SUM(a.allocated_qty), 0)               AS remaining_qty,
  pl.theoretical_weight_kg,
  pl.actual_weight_kg,
  COALESCE(pl.actual_weight_kg, pl.theoretical_weight_kg, 0)
    - COALESCE(SUM(a.allocated_weight_kg), 0)                       AS remaining_weight_kg,
  pl.unit_price_krw,
  pl.grade, pl.length_mm, pl.bars_count,
  pl.status,
  pl.created_at                                                     AS acquired_at
FROM purchase_line pl
LEFT JOIN (
  SELECT al.purchase_line_id, al.allocated_qty, al.allocated_weight_kg
  FROM sale_line_allocation al
  JOIN sale_line sl ON sl.id = al.sale_line_id AND sl.deleted_at IS NULL
  JOIN sale s       ON s.id = sl.sale_id AND s.deleted_at IS NULL AND s.status <> 'cancelled'
) a ON a.purchase_line_id = pl.id
WHERE pl.deleted_at IS NULL
  AND pl.status NOT IN ('transferred_out', 'scrapped')
GROUP BY pl.id
HAVING pl.acquired_qty - COALESCE(SUM(a.allocated_qty), 0) > 0;

-- ------------------------------------------------------------
-- 4) 수금완료 — 남은 금액만 입금으로.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION settle_sale_with_payment(p_sale_id uuid, p_bank_account_id uuid, p_settled_on date)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sale          sale%ROWTYPE;
  v_acct_book     book_type;
  v_acct_active   boolean;
  v_partner_name  text;
  v_received      numeric;
  v_amount        numeric;
  v_last_on       date;
  v_last_acct     uuid;
BEGIN
  -- 행 잠금 — 수금 버튼 두 번·삭제와 동시에 돌 때 입금이 두 번 잡히지 않게.
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '매출을 찾을 수 없습니다';
  END IF;
  IF v_sale.status NOT IN ('delivered', 'overdue') THEN
    RAISE EXCEPTION '납품완료 상태에서만 수금완료할 수 있습니다 (현재 상태: %)', v_sale.status;
  END IF;

  -- 이미 받은 입금(지운 매출에서 옮겨 온 수금 등)은 빼고 남은 금액만 입금(양수)으로 기록한다.
  SELECT COALESCE(SUM(amount_krw), 0) INTO v_received
  FROM bank_transaction
  WHERE sale_id = p_sale_id AND deleted_at IS NULL AND amount_krw > 0 AND book = v_sale.book;
  v_amount := v_sale.total_krw - v_received;

  IF v_received > 0 AND v_amount <= 0 THEN
    -- 이미 다 받음 — 새 입금 없이 마지막 실제 입금의 날짜·통장으로 수금완료(삭제 매출 이관의 자동 수금완료와 같은 기준).
    SELECT txn_on, bank_account_id INTO v_last_on, v_last_acct
    FROM bank_transaction
    WHERE sale_id = p_sale_id AND deleted_at IS NULL AND amount_krw > 0 AND book = v_sale.book
    ORDER BY txn_on DESC, created_at DESC
    LIMIT 1;
    UPDATE sale
    SET status = 'settled', settled_on = v_last_on, receive_bank_account_id = v_last_acct
    WHERE id = p_sale_id AND deleted_at IS NULL;
    RETURN;
  END IF;

  SELECT book, is_active INTO v_acct_book, v_acct_active
  FROM bank_account WHERE id = p_bank_account_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '통장을 찾을 수 없습니다';
  END IF;
  IF v_acct_book <> v_sale.book THEN
    RAISE EXCEPTION '매출(%)과 통장(%)의 책이 다릅니다 — 3축 정합 위반', v_sale.book, v_acct_book;
  END IF;
  IF NOT v_acct_active THEN
    RAISE EXCEPTION '사용하지 않는 통장입니다';
  END IF;

  SELECT name INTO v_partner_name FROM partner WHERE id = v_sale.partner_id;

  IF v_amount > 0 THEN
    INSERT INTO bank_transaction (
      bank_account_id, book, txn_on, amount_krw, counterparty, partner_id, sale_id, notes
    ) VALUES (
      p_bank_account_id, v_sale.book, p_settled_on, v_amount,
      v_partner_name, v_sale.partner_id, p_sale_id,
      '매출 수금 [' || v_sale.doc_no || ']'
        || CASE WHEN v_received > 0
                THEN ' (기수금 ' || to_char(v_received, 'FM999,999,999,999,990') || '원 제외)'
                ELSE '' END
    );
  END IF;

  UPDATE sale
  SET status = 'settled',
      settled_on = p_settled_on,
      receive_bank_account_id = p_bank_account_id
  WHERE id = p_sale_id AND deleted_at IS NULL;
END;
$$;

-- ------------------------------------------------------------
-- 6) 발행 기록 — 다른 매출의 행을 고쳐 쓰지 않는다.
-- ------------------------------------------------------------
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
BEGIN
  SELECT book INTO v_book FROM sale WHERE id = p_sale_id AND deleted_at IS NULL;
  IF v_book IS NULL THEN RAISE EXCEPTION '매출을 찾을 수 없습니다'; END IF;
  IF v_book = 'b' THEN RAISE EXCEPTION 'B계좌는 세금계산서를 발행할 수 없습니다'; END IF;
  IF v_mgt IS NULL OR v_mgt = '' THEN RAISE EXCEPTION '문서관리번호(mgt_key)가 필요합니다'; END IF;

  v_issued := v_state IN ('issued','nts_sent','nts_approved');

  SELECT id, sale_id INTO v_id, v_owner FROM tax_invoice
    WHERE book = v_book AND mgt_key = v_mgt AND deleted_at IS NULL;
  -- 같은 관리번호의 기록이 다른 매출(지운 매출 포함)에 있으면 그 행을 고쳐 쓰지 않는다 — 이 매출엔 기록 없이
  -- 발행 표시만 생기는 어긋남을 막는다(0094).
  IF v_id IS NOT NULL AND v_owner <> p_sale_id THEN
    RAISE EXCEPTION '같은 관리번호(%)의 계산서 기록이 다른 매출에 연결돼 있습니다', v_mgt;
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

-- ------------------------------------------------------------
-- 1) 매출 삭제
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_sale(
  p_sale_id        uuid,
  p_payment        text DEFAULT NULL,  -- 수금 기록: 'move'(대상 매출로 옮김) | 'void'(수금 기록 지움)
  p_target_sale_id uuid DEFAULT NULL,  -- 대상 매출(합친·새로 만든 매출, 같은 책)
  p_invoice        text DEFAULT NULL,  -- 발행된 계산서: 'move'(대상 매출로 옮김) | 'keep'(국세청 기록으로 남김)
  p_reason         text DEFAULT NULL,
  p_nts            text DEFAULT NULL   -- 시스템 밖 발행분을 남길 때 국세청 승인번호(알면)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale        sale%ROWTYPE;
  v_target      sale%ROWTYPE;
  v_inv         tax_invoice%ROWTYPE;
  v_partner     partner%ROWTYPE;
  v_has_inv     boolean := false;
  v_ext         boolean := false;   -- 시스템 밖 발행(발행 완료 표시만 있고 기록 없음)
  v_has_target  boolean := p_target_sale_id IS NOT NULL;
  v_today       text := to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_reason      text := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 300);
  v_nts         text := NULLIF(lower(regexp_replace(COALESCE(p_nts, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_dep_count   integer := 0;
  v_dep_sum     numeric := 0;
  v_received    numeric := 0;
  v_excess      numeric := 0;
  v_last_on     date;
  v_last_acct   uuid;
  v_target_settled boolean := false;
  v_inv_result  text := 'none';
  v_inv_label   text;
  v_ht_moved    integer := 0;
  v_ht_released integer := 0;
  v_alloc       integer := 0;
  v_detached    integer := 0;
  v_quote_reset boolean := false;
  v_pay_text    text;
  v_inv_text    text;
  v_inv_supply  numeric;
  v_inv_vat     numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  IF p_payment IS NOT NULL AND p_payment NOT IN ('move', 'void') THEN
    RAISE EXCEPTION '수금 기록 처리 방법이 올바르지 않습니다';
  END IF;
  IF p_invoice IS NOT NULL AND p_invoice NOT IN ('move', 'keep') THEN
    RAISE EXCEPTION '계산서 처리 방법이 올바르지 않습니다';
  END IF;
  IF p_target_sale_id = p_sale_id THEN
    RAISE EXCEPTION '지우는 매출 자신을 대상으로 고를 수 없습니다';
  END IF;
  IF v_nts IS NOT NULL AND v_nts !~ '^[0-9a-z]{24}$' THEN
    RAISE EXCEPTION '국세청 승인번호는 영문·숫자 24자리입니다(하이픈은 빼도 됩니다)';
  END IF;

  -- 지울 매출·대상 매출을 id 순서로 잠근다 — 수금·라인 교체·다른 삭제와 동시에 돌아도 꼬이지 않게.
  PERFORM 1 FROM sale WHERE id IN (p_sale_id, p_target_sale_id) ORDER BY id FOR UPDATE;

  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '매출을 찾을 수 없습니다(이미 삭제됐을 수 있습니다)';
  END IF;
  IF NOT current_user_has_book_role(v_sale.book, 'manager') THEN
    RAISE EXCEPTION '삭제 권한이 없습니다 (manager 이상 필요)';
  END IF;
  IF v_sale.sale_subtype <> 'external' OR v_sale.transfer_id IS NOT NULL THEN
    RAISE EXCEPTION '책 간 이관 매출은 매출 삭제로 지울 수 없습니다(이관 취소로 처리)';
  END IF;
  IF EXISTS (SELECT 1 FROM promissory_note WHERE sale_id = p_sale_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION '어음이 연결된 매출은 삭제할 수 없습니다(어음 연결을 먼저 정리하세요)';
  END IF;

  IF v_has_target THEN
    SELECT * INTO v_target FROM sale WHERE id = p_target_sale_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION '대상 매출을 찾을 수 없습니다';
    END IF;
    IF v_target.book <> v_sale.book THEN
      RAISE EXCEPTION '다른 책의 매출로는 옮길 수 없습니다(3축 분리)';
    END IF;
    IF v_target.status = 'cancelled' THEN
      RAISE EXCEPTION '취소된 매출은 대상으로 고를 수 없습니다';
    END IF;
    IF v_target.sale_subtype <> 'external' OR v_target.transfer_id IS NOT NULL THEN
      RAISE EXCEPTION '책 간 이관 매출은 대상으로 고를 수 없습니다';
    END IF;
  END IF;

  -- 1-1) 수금 기록 — 이 매출의 입금(같은 책, 매입·영수증 겸용 아님).
  SELECT count(*), COALESCE(sum(amount_krw), 0) INTO v_dep_count, v_dep_sum
  FROM bank_transaction
  WHERE sale_id = p_sale_id AND deleted_at IS NULL AND amount_krw > 0
    AND purchase_id IS NULL AND receipt_id IS NULL AND book = v_sale.book;

  IF v_dep_count > 0 THEN
    IF p_payment IS NULL THEN
      RAISE EXCEPTION '수금 기록(입금 %건, %원)을 어떻게 할지 골라 주세요 — 다른 매출로 옮기기 또는 수금 기록 지우기',
        v_dep_count, to_char(v_dep_sum, 'FM999,999,999,999,990');
    END IF;
    IF p_payment = 'move' THEN
      IF NOT v_has_target THEN
        RAISE EXCEPTION '수금 기록을 옮길 매출을 골라 주세요';
      END IF;
      IF v_target.status = 'settled' THEN
        RAISE EXCEPTION '대상 매출 %은(는) 이미 수금완료라 옮기면 같은 돈이 두 번 잡힙니다 — 그 수금에 이 돈이 들어 있으면 수금 기록 지우기를 고르세요', v_target.doc_no;
      END IF;
      UPDATE bank_transaction SET
        sale_id    = p_target_sale_id,
        partner_id = CASE WHEN partner_id IS NOT DISTINCT FROM v_sale.partner_id THEN v_target.partner_id ELSE partner_id END,
        notes      = concat_ws(' ', notes, '[' || v_sale.doc_no || ' 삭제로 ' || v_target.doc_no || '에 이관]')
      WHERE sale_id = p_sale_id AND deleted_at IS NULL AND amount_krw > 0
        AND purchase_id IS NULL AND receipt_id IS NULL AND book = v_sale.book;

      -- 대상이 납품완료(연체)이고 입금이 합계를 채우면 수금완료 — 마지막 입금의 날짜·통장으로.
      SELECT COALESCE(sum(amount_krw), 0) INTO v_received
      FROM bank_transaction
      WHERE sale_id = p_target_sale_id AND deleted_at IS NULL AND amount_krw > 0 AND book = v_target.book;
      v_excess := GREATEST(v_received - v_target.total_krw, 0);
      IF v_target.status IN ('delivered', 'overdue') AND v_received >= v_target.total_krw THEN
        SELECT txn_on, bank_account_id INTO v_last_on, v_last_acct
        FROM bank_transaction
        WHERE sale_id = p_target_sale_id AND deleted_at IS NULL AND amount_krw > 0 AND book = v_target.book
        ORDER BY txn_on DESC, created_at DESC
        LIMIT 1;
        UPDATE sale
        SET status = 'settled', settled_on = v_last_on, receive_bank_account_id = v_last_acct, updated_by = auth.uid()
        WHERE id = p_target_sale_id;
        v_target_settled := true;
      END IF;
      v_pay_text := format('수금 %s건 %s원 → %s%s%s', v_dep_count, to_char(v_dep_sum, 'FM999,999,999,999,990'),
                           v_target.doc_no,
                           CASE WHEN v_target_settled THEN '(수금완료 처리)' ELSE '' END,
                           CASE WHEN v_excess > 0 THEN '(합계보다 ' || to_char(v_excess, 'FM999,999,999,999,990') || '원 많음)' ELSE '' END);
    ELSE
      UPDATE bank_transaction SET
        deleted_at = now(),
        notes      = concat_ws(' ', notes, '[' || v_sale.doc_no || ' 삭제로 수금 기록 지움' || COALESCE(': ' || v_reason, '') || ']')
      WHERE sale_id = p_sale_id AND deleted_at IS NULL AND amount_krw > 0
        AND purchase_id IS NULL AND receipt_id IS NULL AND book = v_sale.book;
      v_pay_text := format('수금 %s건 %s원 기록 지움', v_dep_count, to_char(v_dep_sum, 'FM999,999,999,999,990'));
    END IF;
  END IF;

  -- 1-2) 그 밖에 이 매출을 가리키는 통장 거래(출금·매입 겸용 등 — 정상 흐름엔 없음)는 거래는 두고 연결만 푼다.
  --      다른 책 거래엔 이 매출 번호를 적지 않는다(B계좌 격리).
  UPDATE bank_transaction SET
    sale_id = NULL,
    notes   = CASE WHEN book = v_sale.book
                   THEN concat_ws(' ', notes, '[매출 ' || v_sale.doc_no || ' 삭제로 연결 해제]')
                   ELSE notes END
  WHERE sale_id = p_sale_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_detached = ROW_COUNT;

  -- 1-3) 세금계산서 — 국세청에 있는 문서는 지우지 않는다.
  SELECT * INTO v_inv FROM tax_invoice
  WHERE sale_id = p_sale_id AND deleted_at IS NULL AND state <> 'cancelled'
  ORDER BY created_at DESC
  LIMIT 1;
  v_has_inv := FOUND;
  v_ext := NOT v_has_inv AND v_sale.tax_invoice_issued_on IS NOT NULL AND v_sale.book <> 'b';

  IF v_has_inv AND v_inv.state IN ('draft', 'failed') THEN
    UPDATE tax_invoice
    SET state = 'cancelled',
        internal_note = concat_ws(' ', internal_note, '[매출 ' || v_sale.doc_no || ' 삭제로 정리 ' || v_today || ']'),
        updated_by = auth.uid()
    WHERE id = v_inv.id;
    v_inv_result := 'cleaned';
    v_inv_text := '미발행 계산서 기록 정리';
  ELSIF v_has_inv OR v_ext THEN
    v_inv_label := CASE WHEN v_has_inv THEN COALESCE(v_inv.nts_confirm_num, v_inv.mgt_key)
                        ELSE '시스템 밖 발행분(' || v_sale.tax_invoice_issued_on || ')' END;
    IF p_invoice IS NULL THEN
      RAISE EXCEPTION '발행된 세금계산서(%)가 있습니다 — 대상 매출로 옮길지, 국세청 기록으로 남기고 지울지 골라 주세요', v_inv_label;
    END IF;
    IF p_invoice = 'move' THEN
      IF NOT v_has_target THEN
        RAISE EXCEPTION '계산서를 옮길 매출을 골라 주세요';
      END IF;
      IF v_target.partner_id <> v_sale.partner_id THEN
        RAISE EXCEPTION '거래처가 다른 매출로는 계산서를 옮길 수 없습니다';
      END IF;
      IF NOT v_target.is_documented THEN
        RAISE EXCEPTION '무자료 매출로는 계산서를 옮길 수 없습니다';
      END IF;
      IF v_target.tax_invoice_issued_on IS NOT NULL
         OR EXISTS (SELECT 1 FROM tax_invoice WHERE sale_id = p_target_sale_id AND deleted_at IS NULL AND state <> 'cancelled') THEN
        RAISE EXCEPTION '대상 매출 %에 이미 계산서가 있습니다(발행 기록 또는 발행 완료 표시)', v_target.doc_no;
      END IF;
      -- 금액 — 발행 기록이 있으면 계산서 금액, 시스템 밖 발행분이면 지우는 매출 금액과 같아야 한다.
      v_inv_supply := COALESCE(v_inv.supply_krw, v_sale.subtotal_krw);
      v_inv_vat := COALESCE(v_inv.vat_krw, v_sale.vat_krw);
      IF v_target.subtotal_krw <> v_inv_supply OR v_target.vat_krw <> v_inv_vat THEN
        RAISE EXCEPTION '대상 매출 금액(공급가 %원·세액 %원)이 계산서(공급가 %원·세액 %원)와 달라 옮길 수 없습니다 — 금액이 바뀌면 수정세금계산서가 필요합니다',
          to_char(v_target.subtotal_krw, 'FM999,999,999,999,990'), to_char(v_target.vat_krw, 'FM999,999,999,999,990'),
          to_char(v_inv_supply, 'FM999,999,999,999,990'), to_char(v_inv_vat, 'FM999,999,999,999,990');
      END IF;
      IF v_has_inv THEN
        UPDATE tax_invoice
        SET sale_id = p_target_sale_id,
            internal_note = concat_ws(' ', internal_note, '[매출 ' || v_sale.doc_no || ' → ' || v_target.doc_no || ' 이관 ' || v_today || ']'),
            updated_by = auth.uid()
        WHERE id = v_inv.id;
        UPDATE hometax_invoice
        SET sale_id = p_target_sale_id,
            notes = concat_ws(' | ', notes, '매출 ' || v_sale.doc_no || ' → ' || v_target.doc_no || ' 이관(' || v_today || ')')
        WHERE sale_id = p_sale_id AND deleted_at IS NULL;
        GET DIAGNOSTICS v_ht_moved = ROW_COUNT;
      END IF;
      UPDATE sale
      SET tax_invoice_issued_on = COALESCE(v_sale.tax_invoice_issued_on, v_inv.write_date),
          tax_doc_no = COALESCE(v_inv.nts_confirm_num, v_sale.tax_doc_no),
          updated_by = auth.uid()
      WHERE id = p_target_sale_id;
      v_inv_result := 'moved';
      v_inv_text := '계산서 ' || v_inv_label || ' → ' || v_target.doc_no;
    ELSE
      IF v_has_inv THEN
        UPDATE tax_invoice
        SET internal_note = concat_ws(' ', internal_note, '[매출 ' || v_sale.doc_no || ' 삭제 ' || v_today
                                        || ' — 수정세금계산서(−)·발행취소 확인 필요' || COALESCE(': ' || v_reason, '') || ']'),
            updated_by = auth.uid()
        WHERE id = v_inv.id;
      ELSE
        -- 시스템 밖 발행분 — 정리 필요 목록과 홈택스 대사가 알아보게 수기 기록을 남긴다(금액·거래처·발행 표시일).
        SELECT * INTO v_partner FROM partner WHERE id = v_sale.partner_id;
        INSERT INTO tax_invoice (
          book, sale_id, provider, mgt_key, nts_confirm_num, state, purpose, write_date,
          supplier, buyer, lines, supply_krw, vat_krw, total_krw, internal_note, issued_at
        ) VALUES (
          v_sale.book, p_sale_id, 'manual', 'ext-' || v_sale.book || '-' || v_sale.doc_no,
          COALESCE(v_nts, v_sale.tax_doc_no), 'issued', 'charge', v_sale.tax_invoice_issued_on,
          COALESCE((SELECT jsonb_build_object('corpNum', regexp_replace(COALESCE(c.business_no, ''), '\D', '', 'g'), 'name', c.name)
                    FROM company_profile c WHERE c.book = v_sale.book LIMIT 1), '{}'::jsonb),
          jsonb_build_object('corpNum', regexp_replace(COALESCE(v_partner.business_no, ''), '\D', '', 'g'), 'name', v_partner.name),
          '[]'::jsonb, v_sale.subtotal_krw, v_sale.vat_krw, v_sale.total_krw,
          '[매출 ' || v_sale.doc_no || ' 삭제 ' || v_today || ' — 시스템 밖 발행분(발행 완료 표시) 기록 · 수정세금계산서(−)·발행취소 확인 필요'
            || COALESCE(': ' || v_reason, '') || ']',
          now()
        )
        RETURNING * INTO v_inv;
        v_has_inv := true;
      END IF;
      v_inv_result := 'kept';
      v_inv_text := '계산서 ' || v_inv_label || ' 국세청 기록 유지(수정세금계산서 확인)';
    END IF;
  END IF;

  -- 1-4) 홈택스 수집본 — 아직 이 매출을 가리키면(계산서를 옮기지 않은 경우) 일치·연결은 '무시(매출 삭제)'로 두어
  --      다음 대사에서 같은 계산서로 매출을 되살리지 않게 한다. 후보 등은 연결만 푼다.
  UPDATE hometax_invoice
  SET match_status  = CASE WHEN match_status IN ('matched', 'linked') THEN 'ignored' ELSE 'unmatched' END,
      ignore_reason = CASE WHEN match_status IN ('matched', 'linked')
                           THEN '매출 ' || v_sale.doc_no || ' 삭제(' || v_today || ')' ELSE ignore_reason END,
      sale_id       = CASE WHEN match_status IN ('matched', 'linked') THEN sale_id ELSE NULL END,
      matched_at    = NULL,
      notes         = concat_ws(' | ', notes, '매출 ' || v_sale.doc_no || ' 삭제(' || v_today || ') — 수정세금계산서·대체 매출 확인')
  WHERE sale_id = p_sale_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_ht_released = ROW_COUNT;

  -- 1-5) 재고 할당 — 지운 매출의 출고는 없던 일로(재고로 돌아감). 감사 기록(trg_audit_allocation)은 남는다.
  DELETE FROM sale_line_allocation a
  USING sale_line sl
  WHERE a.sale_line_id = sl.id AND sl.sale_id = p_sale_id;
  GET DIAGNOSTICS v_alloc = ROW_COUNT;

  -- 1-6) 견적 출처 — 대상에 비어 있으면 넘긴다. 대상 없이 지우고 그 견적의 산 매출이 더 없으면 '발송'으로 되돌려 다시 전환할 수 있게.
  IF v_sale.source_quote_id IS NOT NULL THEN
    IF v_has_target THEN
      IF v_target.source_quote_id IS NULL THEN
        UPDATE sale SET source_quote_id = v_sale.source_quote_id WHERE id = p_target_sale_id;
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM sale
                      WHERE source_quote_id = v_sale.source_quote_id AND id <> p_sale_id
                        AND deleted_at IS NULL AND status <> 'cancelled') THEN
      UPDATE quote
      SET status = (CASE WHEN sent_on IS NOT NULL THEN 'sent' ELSE 'draft' END)::quote_status
      WHERE id = v_sale.source_quote_id AND status = 'won';
      v_quote_reset := FOUND;
    END IF;
  END IF;

  -- 1-7) 메모 — 지운 매출(감사용)과 대상 매출(연결·옮겨 온 것)에 처리 내용을 남긴다.
  INSERT INTO sale_memo (sale_id, body)
  VALUES (p_sale_id, left(concat_ws(' · ', '[매출 삭제]', v_pay_text, v_inv_text,
                                    CASE WHEN v_has_target THEN '대상 ' || v_target.doc_no END,
                                    CASE WHEN v_quote_reset THEN '견적을 발송 상태로 되돌림' END,
                                    '사유: ' || v_reason), 2000));
  IF v_has_target THEN
    INSERT INTO sale_memo (sale_id, body)
    VALUES (p_target_sale_id, left(concat_ws(' · ',
                                             '[삭제 매출 연결] ' || v_sale.doc_no || '(' || to_char(v_sale.total_krw, 'FM999,999,999,999,990') || '원) 삭제',
                                             v_pay_text, v_inv_text, '사유: ' || v_reason), 2000));
  END IF;

  -- 1-8) 라인·헤더 soft delete — 헤더는 이 함수만 바꿀 수 있다(trg_sale_guard_update).
  UPDATE sale_line SET deleted_at = now() WHERE sale_id = p_sale_id AND deleted_at IS NULL;
  PERFORM set_config('app.sale_delete', 'on', true);
  UPDATE sale SET deleted_at = now(), updated_by = auth.uid() WHERE id = p_sale_id;
  PERFORM set_config('app.sale_delete', '', true);

  RETURN jsonb_build_object(
    'doc_no',         v_sale.doc_no,
    'book',           v_sale.book,
    'payment',        CASE WHEN v_dep_count = 0 THEN 'none' ELSE p_payment END,
    'deposit_count',  v_dep_count,
    'deposit_sum',    v_dep_sum,
    'excess',         v_excess,
    'target_id',      p_target_sale_id,
    'target_doc_no',  CASE WHEN v_has_target THEN v_target.doc_no END,
    'target_settled', v_target_settled,
    'invoice',        v_inv_result,
    'invoice_label',  v_inv_label,
    'hometax',        v_ht_moved + v_ht_released,
    'allocations',    v_alloc,
    'detached',       v_detached,
    'quote_reset',    v_quote_reset
  );
END;
$$;

REVOKE ALL ON FUNCTION delete_sale(uuid, text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_sale(uuid, text, uuid, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION delete_sale(uuid, text, uuid, text, text, text) IS
  '매출 삭제 — 수금 기록(옮김·지움)·발행 계산서(옮김·국세청 기록 유지)·홈택스 연결·재고 할당·견적·메모를 한 트랜잭션으로 (0094)';

-- ------------------------------------------------------------
-- 2) 예전 이름은 delete_sale 로 위임 — 선택이 필요한 매출(입금·발행 계산서)은 거부된다.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_sale(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM delete_sale(p_id);
END;
$$;
REVOKE ALL ON FUNCTION soft_delete_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION soft_delete_sale(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 5) 지운 매출에 남긴 계산서 정리.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION close_deleted_sale_invoice(
  p_invoice_id uuid,
  p_resolution text,
  p_note       text DEFAULT NULL,
  p_nts        text DEFAULT NULL   -- 승인번호가 없던 기록의 원 국세청 승인번호('modified' 면 필수)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv  tax_invoice%ROWTYPE;
  v_doc  text;
  v_del  timestamptz;
  v_note text := left(NULLIF(btrim(COALESCE(p_note, '')), ''), 300);
  v_nts  text;
  v_new_nts text := NULLIF(lower(regexp_replace(COALESCE(p_nts, ''), '[^0-9A-Za-z]', '', 'g')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  IF p_resolution IS NULL OR p_resolution NOT IN ('modified', 'cancelled') THEN
    RAISE EXCEPTION '정리 방법이 올바르지 않습니다(수정세금계산서 발행·발행취소)';
  END IF;
  IF v_new_nts IS NOT NULL AND v_new_nts !~ '^[0-9a-z]{24}$' THEN
    RAISE EXCEPTION '국세청 승인번호는 영문·숫자 24자리입니다(하이픈은 빼도 됩니다)';
  END IF;
  SELECT * INTO v_inv FROM tax_invoice WHERE id = p_invoice_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '계산서 기록을 찾을 수 없습니다';
  END IF;
  IF NOT current_user_has_book_role(v_inv.book, 'manager') THEN
    RAISE EXCEPTION '권한이 없습니다 (manager 이상 필요)';
  END IF;
  SELECT doc_no, deleted_at INTO v_doc, v_del FROM sale WHERE id = v_inv.sale_id;
  IF v_del IS NULL THEN
    RAISE EXCEPTION '매출이 살아 있는 계산서는 매출 상세의 [계산서]에서 처리하세요';
  END IF;
  IF v_inv.state = 'cancelled' OR v_inv.resolved_at IS NOT NULL THEN
    RETURN;
  END IF;
  -- 수정세금계산서로 정리한 원본은 국세청에 남는다 — 승인번호가 있어야 홈택스 대사가 알아보고 매출을 되살리지 않는다.
  IF p_resolution = 'modified' AND v_inv.nts_confirm_num IS NULL AND v_new_nts IS NULL THEN
    RAISE EXCEPTION '승인번호가 없는 기록입니다 — 원 계산서의 국세청 승인번호(24자리)를 넣어 주세요';
  END IF;
  IF v_new_nts IS NOT NULL AND v_inv.nts_confirm_num IS NOT NULL
     AND lower(regexp_replace(v_inv.nts_confirm_num, '[^0-9A-Za-z]', '', 'g')) <> v_new_nts THEN
    RAISE EXCEPTION '이 기록에는 이미 다른 승인번호(%)가 있습니다', v_inv.nts_confirm_num;
  END IF;

  UPDATE tax_invoice
  SET state = CASE WHEN p_resolution = 'cancelled' THEN 'cancelled'::tax_invoice_state ELSE state END,
      nts_confirm_num = COALESCE(nts_confirm_num, v_new_nts),
      resolved_at = now(),
      resolution = p_resolution,
      resolved_by = auth.uid(),
      internal_note = concat_ws(' ', internal_note,
                                '[정리 ' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') || ' — '
                                || CASE WHEN p_resolution = 'cancelled' THEN '발행취소' ELSE '수정세금계산서(−) 발행' END
                                || COALESCE(': ' || v_note, '') || ']'),
      updated_by = auth.uid()
  WHERE id = p_invoice_id;

  -- 같은 국세청 문서의 홈택스 수집본은 '무시' — 다음 대사에서 매출을 만들거나 다른 매출에 붙이지 않게.
  v_nts := COALESCE(NULLIF(lower(regexp_replace(COALESCE(v_inv.nts_confirm_num, ''), '[^0-9A-Za-z]', '', 'g')), ''), v_new_nts);
  UPDATE hometax_invoice
  SET match_status = 'ignored',
      ignore_reason = COALESCE(ignore_reason, '지운 매출 ' || v_doc || '의 계산서 — 정리 완료'),
      tax_invoice_id = COALESCE(tax_invoice_id, p_invoice_id),
      matched_at = NULL
  WHERE deleted_at IS NULL AND match_status <> 'ignored'
    AND (tax_invoice_id = p_invoice_id
         OR (v_nts IS NOT NULL AND book = v_inv.book
             AND lower(regexp_replace(nts_confirm_num, '[^0-9A-Za-z]', '', 'g')) = v_nts));
END;
$$;

REVOKE ALL ON FUNCTION close_deleted_sale_invoice(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_deleted_sale_invoice(uuid, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION close_deleted_sale_invoice(uuid, text, text, text) IS
  '지운 매출에 남긴 세금계산서 정리 — modified(수정세금계산서 발행, 합계 유지)·cancelled(발행취소, 합계 제외) (0094)';

-- ------------------------------------------------------------
-- 3) 매출 트리거 — 삭제·복구는 delete_sale 로만, 입금이 붙은 매출은 취소 불가.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sale_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND COALESCE(current_setting('app.sale_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION '매출 삭제·복구는 [삭제] 기능(delete_sale)으로만 할 수 있습니다';
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
     AND EXISTS (SELECT 1 FROM bank_transaction
                 WHERE sale_id = NEW.id AND deleted_at IS NULL AND amount_krw > 0) THEN
    RAISE EXCEPTION '입금 기록이 있는 매출은 취소할 수 없습니다 — [삭제]에서 수금 기록을 다른 매출로 옮기거나 지우세요';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION sale_guard_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sale_guard_update ON sale;
CREATE TRIGGER trg_sale_guard_update
  BEFORE UPDATE OF deleted_at, status ON sale
  FOR EACH ROW EXECUTE FUNCTION sale_guard_update();

-- 하드 DELETE 는 쓰지 않는다(soft delete 만). 서비스 롤 스크립트는 RLS 밖이라 영향 없음.
DROP POLICY IF EXISTS p_sale_delete ON sale;

-- PostgREST schema cache 강제 reload
NOTIFY pgrst, 'reload schema';
