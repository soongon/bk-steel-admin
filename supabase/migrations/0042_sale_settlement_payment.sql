-- ============================================================
-- 0042_sale_settlement_payment.sql
-- 수금완료 ↔ 통장 입금 연동 — 매출 상태와 실제 입금을 한 트랜잭션으로 일치
-- 참조: Codex 감사(2026-06) High — settle가 통장거래·3축 정합과 분리돼 있던 문제
-- ============================================================

-- 납품완료/연체 매출을 수금완료 처리하면서 통장 입금(bank_transaction) 을 함께 기록.
-- 3축 정합: 통장.book = 매출.book 강제(통장 자체 CHECK가 book↔kind 보장 → b는 b_hidden).
-- SECURITY INVOKER → 호출자 RLS 적용. 상태 가드로 이중 수금/중복 입금 방지.
CREATE OR REPLACE FUNCTION settle_sale_with_payment(
  p_sale_id          uuid,
  p_bank_account_id  uuid,
  p_settled_on       date
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sale          sale%ROWTYPE;
  v_acct_book     book_type;
  v_acct_active   boolean;
  v_partner_name  text;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '매출을 찾을 수 없습니다';
  END IF;
  IF v_sale.status NOT IN ('delivered', 'overdue') THEN
    RAISE EXCEPTION '납품완료 상태에서만 수금완료할 수 있습니다 (현재 상태: %)', v_sale.status;
  END IF;

  SELECT book, is_active INTO v_acct_book, v_acct_active
  FROM bank_account WHERE id = p_bank_account_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '통장을 찾을 수 없습니다';
  END IF;
  IF v_acct_book <> v_sale.book THEN
    RAISE EXCEPTION '매출(%)과 통장(%)의 책이 다릅니다 — 3축 정합 위반', v_sale.book, v_acct_book;
  END IF;

  SELECT name INTO v_partner_name FROM partner WHERE id = v_sale.partner_id;

  -- 입금 거래(양수 = 입금)
  INSERT INTO bank_transaction (
    bank_account_id, book, txn_on, amount_krw, counterparty, partner_id, sale_id, notes
  ) VALUES (
    p_bank_account_id, v_sale.book, p_settled_on, v_sale.total_krw,
    v_partner_name, v_sale.partner_id, p_sale_id,
    '매출 수금 [' || v_sale.doc_no || ']'
  );

  -- 매출 수금완료 + 수금 통장 기록
  UPDATE sale
  SET status = 'settled',
      settled_on = p_settled_on,
      receive_bank_account_id = p_bank_account_id
  WHERE id = p_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION settle_sale_with_payment(uuid, uuid, date) TO authenticated;
