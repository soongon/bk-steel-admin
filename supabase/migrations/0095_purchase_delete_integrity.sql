-- ============================================================
-- 0095_purchase_delete_integrity.sql
-- 매입 삭제 — 결제완료 매입도 지울 수 있게 + 지울 때 딸린 데이터 정합 (사용자 요청 2026-10-28, 매출 0094 와 같은 방식).
--   쓰임새: 공급자의 월 합산 계산서에 맞춰 여러 매입을 하나로 합치거나, 내용이 바뀐 매입을 새로 만들고 옛 매입을 지운다.
--   지금까지 soft_delete_purchase(0047)는 결제완료면 거부했고, 홈택스 매입 수집본 연결은 지운 매입을 가리킨 채 '연결됨'으로 남았다.
--
--   매출과 다른 점(매입 고유):
--     · 매입 품목 = 재고 lot. 다른(살아 있는) 매출이 출고해 간 lot·가공/절단 자식·재고 조정이 걸린 매입은 지우지 않는다
--       (매출처럼 할당을 풀면 그 매출의 원가가 바뀐다 — 0093 품목 수정 가드와 같은 기준). 지우면 lot 은 재고에서 빠진다.
--     · 계산서는 공급자가 발행한 문서 — 우리 기록은 홈택스 매입 수집본(hometax_invoice buy) + purchase.tax_doc_no 뿐.
--       'move' = 대상 매입으로 옮김(같은 매입처·공급가 같을 때, 세액은 공급자 끝전 차이 10원까지 계산서 기준으로 맞춤 — 대상에
--       결제 기록이 없을 때만). 수집본 여러 장(당초·수정(−)·재발행 묶음)은 순합계로 비교해 모두 옮기고 증빙 번호는 대표 장.
--       승인번호 없이 '계산서 수취'만 표시된 자료 매입도 계산서가 있는 것으로 보고 고르게 한다('move' = 수취 표시를 옮김). 'keep' = 수집본을 '무시(매입 삭제)'로 두고 홈택스 화면 '정리 필요'에 남김 — 다음 대사에서
--       매입을 되살리지(P_create) 않게.
--     · 결제 = 음수 출금(bank_transaction), 결제완료 = paid_on. 'move' 는 대상이 결제완료가 아닐 때만, 합계를 채우면 결제완료
--       (마지막 출금의 날짜·통장 — 매입 결제엔 입고 조건이 없다). 'void' = 결제 기록 지움.
--     · 견적 연결·발행취소·취소 상태는 매입에 없다.
--
--   1) delete_purchase(매입, 결제 처리, 대상 매입, 계산서 처리, 사유) — SECURITY DEFINER, 그 책 manager. 한 트랜잭션.
--   2) soft_delete_purchase 는 delete_purchase 로 위임(선택이 필요한 매입은 거부).
--   3) pay_purchase_with_payment — 이미 나간 출금(옮겨 온 결제)을 빼고 남은 금액만, 다 냈으면 마지막 출금으로 결제완료.
--   4) close_deleted_purchase_invoice — 지운 매입의 계산서(수집본) 정리 완료 표시(hometax_invoice.resolved_at).
--   5) 트리거: 매입·매입 라인 deleted_at 은 delete_purchase 로만. 하드 DELETE 정책 제거(홈택스 되돌리기는 서비스 롤이라 무관).
--   6) vw_inventory — 매입 헤더가 지워진 lot 도 빼도록 헤더 조인(방어).
--   7) replace_purchase_lines EXECUTE 를 anon 에서 회수(0093 은 PUBLIC 만 회수).
-- ============================================================

-- ------------------------------------------------------------
-- 4') 수집본 정리 표시 컬럼
-- ------------------------------------------------------------
ALTER TABLE hometax_invoice
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;
COMMENT ON COLUMN hometax_invoice.resolved_at IS
  '지운 매입의 공급자 계산서를 정리한 시각(공급자 수정세금계산서·대체 매입 확인) — 홈택스 화면 정리 필요에서 빠짐 (0095)';

-- ------------------------------------------------------------
-- 6) 재고 — 지운 매입(헤더)의 lot 도 뺀다(라인만 남는 유령 재고 방어).
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
JOIN purchase p ON p.id = pl.purchase_id AND p.deleted_at IS NULL
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
-- 3) 결제완료 — 남은 금액만 출금으로.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pay_purchase_with_payment(p_purchase_id uuid, p_bank_account_id uuid, p_paid_on date)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pur           purchase%ROWTYPE;
  v_acct_book     book_type;
  v_acct_active   boolean;
  v_partner_name  text;
  v_paid          numeric;
  v_amount        numeric;
  v_last_on       date;
  v_last_acct     uuid;
BEGIN
  -- FOR UPDATE: 동시 두 요청이 같은 paid_on=null 을 보고 중복 출금하는 race 차단.
  SELECT * INTO v_pur FROM purchase WHERE id = p_purchase_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '매입을 찾을 수 없습니다';
  END IF;
  IF v_pur.paid_on IS NOT NULL THEN
    RAISE EXCEPTION '이미 결제완료된 매입입니다 (결제일: %)', v_pur.paid_on;
  END IF;

  -- 이미 나간 출금(지운 매입에서 옮겨 온 결제 등)은 빼고 남은 금액만 출금(음수)으로 기록한다(0095).
  SELECT COALESCE(SUM(-amount_krw), 0) INTO v_paid
  FROM bank_transaction
  WHERE purchase_id = p_purchase_id AND deleted_at IS NULL AND amount_krw < 0 AND book = v_pur.book;
  v_amount := v_pur.total_krw - v_paid;

  IF v_paid > 0 AND v_amount <= 0 THEN
    -- 이미 다 냄 — 새 출금 없이 마지막 실제 출금의 날짜·통장으로 결제완료(삭제 매입 이관의 자동 결제완료와 같은 기준).
    SELECT txn_on, bank_account_id INTO v_last_on, v_last_acct
    FROM bank_transaction
    WHERE purchase_id = p_purchase_id AND deleted_at IS NULL AND amount_krw < 0 AND book = v_pur.book
    ORDER BY txn_on DESC, created_at DESC
    LIMIT 1;
    UPDATE purchase
    SET paid_on = v_last_on, pay_bank_account_id = v_last_acct
    WHERE id = p_purchase_id AND deleted_at IS NULL;
    RETURN;
  END IF;

  SELECT book, is_active INTO v_acct_book, v_acct_active
  FROM bank_account WHERE id = p_bank_account_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '통장을 찾을 수 없습니다';
  END IF;
  IF NOT v_acct_active THEN
    RAISE EXCEPTION '비활성 통장으로는 결제할 수 없습니다';
  END IF;
  IF v_acct_book <> v_pur.book THEN
    RAISE EXCEPTION '매입(%)과 통장(%)의 책이 다릅니다 — 3축 정합 위반', v_pur.book, v_acct_book;
  END IF;

  SELECT name INTO v_partner_name FROM partner WHERE id = v_pur.partner_id;

  IF v_amount > 0 THEN
    INSERT INTO bank_transaction (
      bank_account_id, book, txn_on, amount_krw, counterparty, partner_id, purchase_id, notes
    ) VALUES (
      p_bank_account_id, v_pur.book, p_paid_on, -v_amount,
      v_partner_name, v_pur.partner_id, p_purchase_id,
      '매입 결제 [' || v_pur.doc_no || ']'
        || CASE WHEN v_paid > 0
                THEN ' (기지급 ' || to_char(v_paid, 'FM999,999,999,999,990') || '원 제외)'
                ELSE '' END
    );
  END IF;

  UPDATE purchase
  SET paid_on = p_paid_on, pay_bank_account_id = p_bank_account_id
  WHERE id = p_purchase_id AND deleted_at IS NULL;
END;
$$;

-- ------------------------------------------------------------
-- 1) 매입 삭제
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_purchase(
  p_purchase_id        uuid,
  p_payment            text DEFAULT NULL,  -- 결제 기록: 'move'(대상 매입으로 옮김) | 'void'(결제 기록 지움)
  p_target_purchase_id uuid DEFAULT NULL,  -- 대상 매입(합친·새로 만든 매입, 같은 책)
  p_invoice            text DEFAULT NULL,  -- 공급자 계산서: 'move'(대상 매입으로 옮김) | 'keep'(국세청 기록으로 남김)
  p_reason             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pur          purchase%ROWTYPE;
  v_target       purchase%ROWTYPE;
  v_has_target   boolean := p_target_purchase_id IS NOT NULL;
  v_today        text := to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
  v_reason       text := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 300);
  v_block_docs   text;
  v_blocked      boolean;
  v_pay_count    integer := 0;
  v_pay_sum      numeric := 0;
  v_paid         numeric := 0;
  v_excess       numeric := 0;
  v_last_on      date;
  v_last_acct    uuid;
  v_target_paid  boolean := false;
  v_ht_count     integer := 0;
  v_ht_supply    numeric;
  v_ht_vat       numeric;
  v_ht_nts       text;
  v_ext_received boolean := false;
  v_has_invoice  boolean := false;
  v_inv_supply   numeric;
  v_inv_vat      numeric;
  v_inv_label    text;
  v_inv_result   text := 'none';
  v_vat_adjusted boolean := false;
  v_ht_moved     integer := 0;
  v_ht_released  integer := 0;
  v_detached     integer := 0;
  v_lines        integer := 0;
  v_prices       integer := 0;
  v_pay_text     text;
  v_inv_text     text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  IF p_payment IS NOT NULL AND p_payment NOT IN ('move', 'void') THEN
    RAISE EXCEPTION '결제 기록 처리 방법이 올바르지 않습니다';
  END IF;
  IF p_invoice IS NOT NULL AND p_invoice NOT IN ('move', 'keep') THEN
    RAISE EXCEPTION '계산서 처리 방법이 올바르지 않습니다';
  END IF;
  IF p_target_purchase_id = p_purchase_id THEN
    RAISE EXCEPTION '지우는 매입 자신을 대상으로 고를 수 없습니다';
  END IF;

  -- 지울 매입·대상 매입을 id 순서로 잠근다 — 결제·품목 수정·다른 삭제와 동시에 돌아도 꼬이지 않게.
  PERFORM 1 FROM purchase WHERE id IN (p_purchase_id, p_target_purchase_id) ORDER BY id FOR UPDATE;

  SELECT * INTO v_pur FROM purchase WHERE id = p_purchase_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '매입을 찾을 수 없습니다(이미 삭제됐을 수 있습니다)';
  END IF;
  IF NOT current_user_has_book_role(v_pur.book, 'manager') THEN
    RAISE EXCEPTION '삭제 권한이 없습니다 (manager 이상 필요)';
  END IF;
  IF v_pur.purchase_subtype <> 'external' OR v_pur.transfer_id IS NOT NULL THEN
    RAISE EXCEPTION '책 간 이관 매입은 매입 삭제로 지울 수 없습니다(이관 취소로 처리)';
  END IF;
  IF EXISTS (SELECT 1 FROM promissory_note WHERE purchase_id = p_purchase_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION '어음이 연결된 매입은 삭제할 수 없습니다(어음 연결을 먼저 정리하세요)';
  END IF;

  -- 재고 이력 — 이 매입의 lot 을 살아 있는 매출이 출고해 갔거나(할당), 가공·절단·재고 조정이 걸려 있으면 지우지 않는다.
  -- (할당을 풀면 그 매출의 원가가 바뀌고, 남기면 지운 lot 에 원가가 묶인다 — 0093 품목 수정 가드와 같은 기준)
  SELECT
    bool_or(TRUE),
    string_agg(DISTINCT s.doc_no, ', ') FILTER (WHERE s.book = v_pur.book)
  INTO v_blocked, v_block_docs
  FROM purchase_line pl
  LEFT JOIN sale_line_allocation a ON a.purchase_line_id = pl.id
  LEFT JOIN sale_line sl ON sl.id = a.sale_line_id AND sl.deleted_at IS NULL
  LEFT JOIN sale s ON s.id = sl.sale_id AND s.deleted_at IS NULL AND s.status <> 'cancelled'
  WHERE pl.purchase_id = p_purchase_id AND pl.deleted_at IS NULL
    AND (
      s.id IS NOT NULL
      OR EXISTS (SELECT 1 FROM purchase_line c WHERE c.parent_purchase_line_id = pl.id AND c.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM inventory_adjustment ia WHERE ia.source_purchase_line_id = pl.id)
      OR pl.created_by_adjustment_id IS NOT NULL
    );
  IF v_blocked THEN
    RAISE EXCEPTION '출고(매출 할당)·가공·재고 조정 이력이 있는 매입은 삭제할 수 없습니다%',
      COALESCE(' — 출고한 매출 ' || v_block_docs || ' 쪽을 먼저 정리하세요', '');
  END IF;

  IF v_has_target THEN
    SELECT * INTO v_target FROM purchase WHERE id = p_target_purchase_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION '대상 매입을 찾을 수 없습니다';
    END IF;
    IF v_target.book <> v_pur.book THEN
      RAISE EXCEPTION '다른 책의 매입으로는 옮길 수 없습니다(3축 분리)';
    END IF;
    IF v_target.purchase_subtype <> 'external' OR v_target.transfer_id IS NOT NULL THEN
      RAISE EXCEPTION '책 간 이관 매입은 대상으로 고를 수 없습니다';
    END IF;
  END IF;

  -- 1-1) 공급자 계산서 — 홈택스 매입 수집본 연결·승인번호, 또는 승인번호 없이 '계산서 수취'만 표시된 자료 매입
  --      (B계좌는 무자료라 없음). 수집본이 여러 장(당초·수정(−)·재발행 묶음)이면 순합계로 본다(수정(−)은 음수).
  SELECT count(*), sum(supply_amount), sum(tax_amount)
  INTO v_ht_count, v_ht_supply, v_ht_vat
  FROM hometax_invoice
  WHERE purchase_id = p_purchase_id AND deleted_at IS NULL;
  -- 대표 승인번호 — 매입의 증빙 번호가 연결 수집본에 있으면 그 장(묶음의 재발행 장), 아니면 (+) 최신 장.
  SELECT nts_confirm_num INTO v_ht_nts
  FROM hometax_invoice
  WHERE purchase_id = p_purchase_id AND deleted_at IS NULL
  ORDER BY (lower(regexp_replace(nts_confirm_num, '[^0-9A-Za-z]', '', 'g'))
              = lower(regexp_replace(COALESCE(v_pur.tax_doc_no, ''), '[^0-9A-Za-z]', '', 'g'))) DESC,
           (total_amount > 0) DESC, write_date DESC, nts_confirm_num DESC
  LIMIT 1;
  -- 승인번호 없이 수취만 표시 — 수집본이 아직 연결 전(매일 수집은 미연결로 쌓임)이라도 지운 뒤 다음 대사가 그 계산서로
  -- 매입을 되살리지 않게 고르게 한다(지운 매입은 거래처·합계·날짜로 D_deleted 판정, 0094 시스템 밖 발행분과 같은 원칙).
  v_ext_received := v_ht_count = 0 AND v_pur.tax_doc_no IS NULL AND v_pur.book <> 'b'
                    AND v_pur.is_documented AND v_pur.tax_invoice_received_on IS NOT NULL;
  v_has_invoice := v_ht_count > 0 OR (v_pur.book <> 'b' AND v_pur.tax_doc_no IS NOT NULL) OR v_ext_received;

  IF v_has_invoice THEN
    v_inv_label := COALESCE(v_ht_nts, v_pur.tax_doc_no,
                            '수취분(승인번호 없음·수취일 ' || to_char(v_pur.tax_invoice_received_on, 'YYYY-MM-DD') || ')');
    IF p_invoice IS NULL THEN
      IF v_ext_received THEN
        RAISE EXCEPTION '계산서 수취로 표시된 매입입니다(승인번호 없음) — 대상 매입으로 옮길지, 국세청 기록으로 남기고 지울지 골라 주세요';
      END IF;
      RAISE EXCEPTION '공급자 세금계산서(%)가 연결된 매입입니다 — 대상 매입으로 옮길지, 국세청 기록으로 남기고 지울지 골라 주세요', v_inv_label;
    END IF;
    IF p_invoice = 'move' THEN
      IF NOT v_has_target THEN
        RAISE EXCEPTION '계산서를 옮길 매입을 골라 주세요';
      END IF;
      IF v_target.partner_id <> v_pur.partner_id THEN
        RAISE EXCEPTION '매입처가 다른 매입으로는 계산서를 옮길 수 없습니다';
      END IF;
      IF NOT v_target.is_documented THEN
        RAISE EXCEPTION '무자료 매입으로는 계산서를 옮길 수 없습니다';
      END IF;
      IF v_target.tax_doc_no IS NOT NULL
         OR EXISTS (SELECT 1 FROM hometax_invoice WHERE purchase_id = p_target_purchase_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION '대상 매입 %에 이미 계산서가 있습니다(승인번호 또는 홈택스 연결)', v_target.doc_no;
      END IF;
      v_inv_supply := COALESCE(v_ht_supply, v_pur.subtotal_krw);
      v_inv_vat := COALESCE(v_ht_vat, v_pur.vat_krw);
      IF v_target.subtotal_krw <> v_inv_supply THEN
        RAISE EXCEPTION '대상 매입 공급가(%원)가 계산서 공급가(%원)와 달라 옮길 수 없습니다 — 금액이 바뀌면 공급자에게 수정세금계산서가 필요합니다',
          to_char(v_target.subtotal_krw, 'FM999,999,999,999,990'), to_char(v_inv_supply, 'FM999,999,999,999,990');
      END IF;
      IF v_target.vat_krw <> v_inv_vat THEN
        -- 공급자 세액 끝전(절사) 차이 — 국세청 계산서가 기준(0093 합계 고정과 같은 원칙). 대상에 결제 기록이 없을 때만 맞춘다.
        IF v_target.paid_on IS NOT NULL
           OR abs(v_target.vat_krw - v_inv_vat) > 10
           OR EXISTS (SELECT 1 FROM bank_transaction WHERE purchase_id = p_target_purchase_id AND deleted_at IS NULL AND amount_krw < 0) THEN
          RAISE EXCEPTION '대상 매입 세액(%원)이 계산서 세액(%원)과 달라 옮길 수 없습니다',
            to_char(v_target.vat_krw, 'FM999,999,999,999,990'), to_char(v_inv_vat, 'FM999,999,999,999,990');
        END IF;
        UPDATE purchase
        SET vat_krw = v_inv_vat, total_krw = v_target.subtotal_krw + v_inv_vat, updated_by = auth.uid()
        WHERE id = p_target_purchase_id;
        v_target.vat_krw := v_inv_vat;
        v_target.total_krw := v_target.subtotal_krw + v_inv_vat;
        v_vat_adjusted := true;
      END IF;
      UPDATE hometax_invoice
      SET purchase_id = p_target_purchase_id,
          notes = concat_ws(' | ', notes, '매입 ' || v_pur.doc_no || ' → ' || v_target.doc_no || ' 이관(' || v_today || ')')
      WHERE purchase_id = p_purchase_id AND deleted_at IS NULL;
      GET DIAGNOSTICS v_ht_moved = ROW_COUNT;
      UPDATE purchase
      SET tax_doc_no = COALESCE(v_ht_nts, v_pur.tax_doc_no),
          tax_invoice_received_on = COALESCE(tax_invoice_received_on, v_pur.tax_invoice_received_on),
          updated_by = auth.uid()
      WHERE id = p_target_purchase_id;
      v_inv_result := 'moved';
      v_inv_text := '계산서 ' || v_inv_label || ' → ' || v_target.doc_no
                    || CASE WHEN v_vat_adjusted THEN '(세액을 계산서 기준으로 맞춤)' ELSE '' END;
    ELSE
      v_inv_result := 'kept';
      v_inv_text := '계산서 ' || v_inv_label || ' 국세청 기록 유지(공급자 수정세금계산서·대체 매입 확인)';
    END IF;
  END IF;

  -- 1-2) 결제 기록 — 이 매입의 출금(같은 책, 매출·영수증 겸용 아님).
  SELECT count(*), COALESCE(sum(-amount_krw), 0) INTO v_pay_count, v_pay_sum
  FROM bank_transaction
  WHERE purchase_id = p_purchase_id AND deleted_at IS NULL AND amount_krw < 0
    AND sale_id IS NULL AND receipt_id IS NULL AND book = v_pur.book;

  IF v_pay_count > 0 THEN
    IF p_payment IS NULL THEN
      RAISE EXCEPTION '결제 기록(출금 %건, %원)을 어떻게 할지 골라 주세요 — 다른 매입으로 옮기기 또는 결제 기록 지우기',
        v_pay_count, to_char(v_pay_sum, 'FM999,999,999,999,990');
    END IF;
    IF p_payment = 'move' THEN
      IF NOT v_has_target THEN
        RAISE EXCEPTION '결제 기록을 옮길 매입을 골라 주세요';
      END IF;
      IF v_target.paid_on IS NOT NULL THEN
        RAISE EXCEPTION '대상 매입 %은(는) 이미 결제완료라 옮기면 같은 돈이 두 번 나갑니다 — 그 결제에 이 돈이 들어 있으면 결제 기록 지우기를 고르세요', v_target.doc_no;
      END IF;
      UPDATE bank_transaction SET
        purchase_id = p_target_purchase_id,
        partner_id  = CASE WHEN partner_id IS NOT DISTINCT FROM v_pur.partner_id THEN v_target.partner_id ELSE partner_id END,
        notes       = concat_ws(' ', notes, '[매입 ' || v_pur.doc_no || ' 삭제로 ' || v_target.doc_no || '에 이관]')
      WHERE purchase_id = p_purchase_id AND deleted_at IS NULL AND amount_krw < 0
        AND sale_id IS NULL AND receipt_id IS NULL AND book = v_pur.book;

      -- 출금이 대상 합계를 채우면 결제완료 — 마지막 출금의 날짜·통장으로(매입 결제엔 입고 조건이 없다).
      SELECT COALESCE(sum(-amount_krw), 0) INTO v_paid
      FROM bank_transaction
      WHERE purchase_id = p_target_purchase_id AND deleted_at IS NULL AND amount_krw < 0 AND book = v_target.book;
      v_excess := GREATEST(v_paid - v_target.total_krw, 0);
      IF v_paid >= v_target.total_krw THEN
        SELECT txn_on, bank_account_id INTO v_last_on, v_last_acct
        FROM bank_transaction
        WHERE purchase_id = p_target_purchase_id AND deleted_at IS NULL AND amount_krw < 0 AND book = v_target.book
        ORDER BY txn_on DESC, created_at DESC
        LIMIT 1;
        UPDATE purchase
        SET paid_on = v_last_on, pay_bank_account_id = v_last_acct, updated_by = auth.uid()
        WHERE id = p_target_purchase_id;
        v_target_paid := true;
      END IF;
      v_pay_text := format('결제 %s건 %s원 → %s%s%s', v_pay_count, to_char(v_pay_sum, 'FM999,999,999,999,990'),
                           v_target.doc_no,
                           CASE WHEN v_target_paid THEN '(결제완료 처리)' ELSE '' END,
                           CASE WHEN v_excess > 0 THEN '(합계보다 ' || to_char(v_excess, 'FM999,999,999,999,990') || '원 많음)' ELSE '' END);
    ELSE
      UPDATE bank_transaction SET
        deleted_at = now(),
        notes      = concat_ws(' ', notes, '[매입 ' || v_pur.doc_no || ' 삭제로 결제 기록 지움' || COALESCE(': ' || v_reason, '') || ']')
      WHERE purchase_id = p_purchase_id AND deleted_at IS NULL AND amount_krw < 0
        AND sale_id IS NULL AND receipt_id IS NULL AND book = v_pur.book;
      v_pay_text := format('결제 %s건 %s원 기록 지움', v_pay_count, to_char(v_pay_sum, 'FM999,999,999,999,990'));
    END IF;
  END IF;

  -- 1-3) 그 밖에 이 매입을 가리키는 통장 거래(입금·매출 겸용 등 — 정상 흐름엔 없음)는 거래는 두고 연결만 푼다.
  UPDATE bank_transaction SET
    purchase_id = NULL,
    notes = CASE WHEN book = v_pur.book
                 THEN concat_ws(' ', notes, '[매입 ' || v_pur.doc_no || ' 삭제로 연결 해제]')
                 ELSE notes END
  WHERE purchase_id = p_purchase_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_detached = ROW_COUNT;

  -- 1-4) 홈택스 매입 수집본 — 아직 이 매입을 가리키면(옮기지 않은 경우) '무시(매입 삭제)'로. 다음 대사가 매입을 되살리지
  --      않고, 홈택스 화면 '정리 필요'에 뜬다(공급자 수정세금계산서·대체 매입 확인 뒤 정리 완료).
  UPDATE hometax_invoice
  SET match_status  = 'ignored',
      ignore_reason = '매입 ' || v_pur.doc_no || ' 삭제(' || v_today || ') — 공급자 수정세금계산서(−)·대체 매입 확인',
      matched_at    = NULL,
      notes         = concat_ws(' | ', notes, '매입 ' || v_pur.doc_no || ' 삭제(' || v_today || ')')
  WHERE purchase_id = p_purchase_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_ht_released = ROW_COUNT;

  -- 1-5) 매입 단가로 쌓인 시세(purchase_derived) — 지운 매입의 값이 오늘 시세·재고 평가에 남지 않게.
  DELETE FROM price_history WHERE source = 'purchase_derived' AND source_label = p_purchase_id::text;
  GET DIAGNOSTICS v_prices = ROW_COUNT;

  -- 1-6) 메모 — 지운 매입(감사용)과 대상 매입(연결·옮겨 온 것).
  INSERT INTO purchase_memo (purchase_id, body)
  VALUES (p_purchase_id, left(concat_ws(' · ', '[매입 삭제]', v_pay_text, v_inv_text,
                                        CASE WHEN v_has_target THEN '대상 ' || v_target.doc_no END,
                                        '사유: ' || v_reason), 2000));
  IF v_has_target THEN
    INSERT INTO purchase_memo (purchase_id, body)
    VALUES (p_target_purchase_id, left(concat_ws(' · ',
                                                 '[삭제 매입 연결] ' || v_pur.doc_no || '(' || to_char(v_pur.total_krw, 'FM999,999,999,999,990') || '원) 삭제',
                                                 v_pay_text, v_inv_text, '사유: ' || v_reason), 2000));
  END IF;

  -- 1-7) 라인(재고 lot)·헤더 soft delete — 이 함수만 바꿀 수 있다(trg_purchase_guard_update·trg_purchase_line_guard_update).
  PERFORM set_config('app.purchase_delete', 'on', true);
  UPDATE purchase_line SET deleted_at = now() WHERE purchase_id = p_purchase_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_lines = ROW_COUNT;
  UPDATE purchase SET deleted_at = now(), updated_by = auth.uid() WHERE id = p_purchase_id;
  PERFORM set_config('app.purchase_delete', '', true);

  RETURN jsonb_build_object(
    'doc_no',        v_pur.doc_no,
    'book',          v_pur.book,
    'payment',       CASE WHEN v_pay_count = 0 THEN 'none' ELSE p_payment END,
    'pay_count',     v_pay_count,
    'pay_sum',       v_pay_sum,
    'excess',        v_excess,
    'target_id',     p_target_purchase_id,
    'target_doc_no', CASE WHEN v_has_target THEN v_target.doc_no END,
    'target_paid',   v_target_paid,
    'invoice',       v_inv_result,
    'invoice_label', v_inv_label,
    'vat_adjusted',  v_vat_adjusted,
    'hometax',       v_ht_moved + v_ht_released,
    'lines',         v_lines,
    'prices',        v_prices,
    'detached',      v_detached
  );
END;
$$;

REVOKE ALL ON FUNCTION delete_purchase(uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_purchase(uuid, text, uuid, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION delete_purchase(uuid, text, uuid, text, text) IS
  '매입 삭제 — 결제 기록(옮김·지움)·공급자 계산서(옮김·국세청 기록 유지)·홈택스 연결·재고 lot·시세·메모를 한 트랜잭션으로 (0095)';

-- ------------------------------------------------------------
-- 2) 예전 이름은 delete_purchase 로 위임 — 선택이 필요한 매입(출금·계산서)은 거부된다.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_purchase(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM delete_purchase(p_id);
END;
$$;
REVOKE ALL ON FUNCTION soft_delete_purchase(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION soft_delete_purchase(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 4) 지운 매입의 공급자 계산서(수집본) 정리 완료.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION close_deleted_purchase_invoice(p_hometax_invoice_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row  hometax_invoice%ROWTYPE;
  v_doc  text;
  v_del  timestamptz;
  v_note text := left(NULLIF(btrim(COALESCE(p_note, '')), ''), 300);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  SELECT * INTO v_row FROM hometax_invoice WHERE id = p_hometax_invoice_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '수집본을 찾을 수 없습니다';
  END IF;
  IF NOT current_user_has_book_role(v_row.book, 'manager') THEN
    RAISE EXCEPTION '권한이 없습니다 (manager 이상 필요)';
  END IF;
  IF v_row.direction <> 'buy' OR v_row.purchase_id IS NULL THEN
    RAISE EXCEPTION '지운 매입에 연결된 매입 계산서만 정리할 수 있습니다';
  END IF;
  SELECT doc_no, deleted_at INTO v_doc, v_del FROM purchase WHERE id = v_row.purchase_id;
  IF v_del IS NULL THEN
    RAISE EXCEPTION '매입이 살아 있는 계산서입니다 — 매입 상세에서 처리하세요';
  END IF;
  IF v_row.resolved_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE hometax_invoice
  SET match_status = 'ignored',
      ignore_reason = COALESCE(ignore_reason, '매입 ' || v_doc || ' 삭제'),
      matched_at = NULL,
      resolved_at = now(),
      resolved_by = auth.uid(),
      notes = concat_ws(' | ', notes, '정리 ' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
                                      || ' — ' || COALESCE(v_note, '공급자 수정세금계산서·대체 매입 확인'))
  WHERE id = p_hometax_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION close_deleted_purchase_invoice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_deleted_purchase_invoice(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION close_deleted_purchase_invoice(uuid, text) IS
  '지운 매입에 남긴 공급자 계산서(홈택스 수집본)를 정리 완료로 표시 — 홈택스 화면 정리 필요에서 빠짐 (0095)';

-- ------------------------------------------------------------
-- 5) 트리거 — 매입·매입 라인 삭제·복구는 delete_purchase 로만.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purchase_guard_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND COALESCE(current_setting('app.purchase_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION '매입 삭제·복구는 [삭제] 기능(delete_purchase)으로만 할 수 있습니다';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION purchase_guard_soft_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_purchase_guard_update ON purchase;
CREATE TRIGGER trg_purchase_guard_update
  BEFORE UPDATE OF deleted_at ON purchase
  FOR EACH ROW EXECUTE FUNCTION purchase_guard_soft_delete();
DROP TRIGGER IF EXISTS trg_purchase_line_guard_update ON purchase_line;
CREATE TRIGGER trg_purchase_line_guard_update
  BEFORE UPDATE OF deleted_at ON purchase_line
  FOR EACH ROW EXECUTE FUNCTION purchase_guard_soft_delete();

-- 하드 DELETE 는 쓰지 않는다(soft delete 만, 라인 교체는 replace_purchase_lines 가 DEFINER 로). 서비스 롤 스크립트는 RLS 밖.
DROP POLICY IF EXISTS p_purchase_delete ON purchase;
DROP POLICY IF EXISTS p_purchase_line_delete ON purchase_line;

-- ------------------------------------------------------------
-- 7) replace_purchase_lines — anon 실행 회수(Supabase 기본 권한이 anon 에 따로 준다).
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION replace_purchase_lines(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION replace_purchase_lines(uuid, jsonb, boolean) TO authenticated;

-- PostgREST schema cache 강제 reload
NOTIFY pgrst, 'reload schema';
