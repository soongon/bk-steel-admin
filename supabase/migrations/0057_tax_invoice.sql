-- ============================================================
-- 0057_tax_invoice.sql
-- 전자세금계산서 발행 — 국세청 ASP(팝빌 등) 실연동. 매출(sale) 건별 1:1.
-- 발행 상태·국세청 승인번호 + 법적 snapshot(공급자/공급받는자/금액/품목) 보존 + sale 동기화.
-- 3축: book bk/sl 만 발행(B계좌는 무자료 — chk_b_undocumented_sale 로 이미 차단, 여기서도 CHECK).
-- 합계 세금계산서는 향후 tax_invoice_sale junction 으로 확장(현재는 건별 sale_id 1:1).
-- ============================================================

DO $$ BEGIN
  CREATE TYPE tax_invoice_state AS ENUM (
    'draft',        -- 작성(미발행)
    'issuing',      -- 발행 요청 중
    'issued',       -- 발행됨(ASP 접수)
    'nts_sent',     -- 국세청 전송됨
    'nts_approved', -- 국세청 승인(승인번호 확정)
    'failed',       -- 발행 실패
    'cancelled'     -- 발행 취소
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- tax_invoice (세금계산서 헤더 — 건별 1:1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_invoice (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book            book_type NOT NULL,
  sale_id         UUID NOT NULL REFERENCES sale(id),

  provider        TEXT NOT NULL DEFAULT 'popbill',    -- ASP 식별(popbill 등)
  mgt_key         TEXT NOT NULL,                      -- 문서관리번호(우리 생성·사업자별 유일·멱등키)
  nts_confirm_num TEXT,                               -- 국세청 승인번호(발행 후 수신)

  state           tax_invoice_state NOT NULL DEFAULT 'draft',
  purpose         TEXT NOT NULL DEFAULT 'charge',     -- charge(청구) / receipt(영수)
  write_date      DATE NOT NULL,                      -- 작성일자

  supplier        JSONB NOT NULL,                     -- 공급자 snapshot(우리: 사업자번호·상호·대표자·주소·업태·종목·담당자·이메일)
  buyer           JSONB NOT NULL,                     -- 공급받는자 snapshot(거래처: 동일 구조)
  lines           JSONB NOT NULL DEFAULT '[]'::jsonb, -- 품목 snapshot(명세)

  supply_krw      NUMERIC(15,0) NOT NULL DEFAULT 0,   -- 공급가액
  vat_krw         NUMERIC(15,0) NOT NULL DEFAULT 0,   -- 세액
  total_krw       NUMERIC(15,0) NOT NULL DEFAULT 0,   -- 합계
  item_summary    TEXT,                               -- 대표 품목명('철근 외 2건')
  remark          TEXT,                               -- 비고

  asp_response    JSONB,                              -- 마지막 ASP 응답 원문(audit)
  issued_at       TIMESTAMPTZ,                        -- 실발행 시각

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES user_profile(user_id),
  updated_by      UUID REFERENCES user_profile(user_id),

  CONSTRAINT chk_tax_invoice_book CHECK (book IN ('bk','sl'))  -- B계좌 세금계산서 발행 금지
);

-- 건별 1:1 — 취소되지 않은 발행은 매출당 1건(중복발행 차단)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoice_sale_active
  ON tax_invoice(sale_id) WHERE deleted_at IS NULL AND state <> 'cancelled';
-- 사업자별 문서관리번호 유일(멱등키)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoice_mgt_key
  ON tax_invoice(book, mgt_key) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tax_invoice_book_date
  ON tax_invoice(book, write_date DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_tax_invoice_updated_at ON tax_invoice;
CREATE TRIGGER trg_tax_invoice_updated_at
  BEFORE UPDATE ON tax_invoice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- RLS — sale/quote 패턴: SELECT viewer / 변경 staff
-- ------------------------------------------------------------
ALTER TABLE tax_invoice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_invoice_select ON tax_invoice;
DROP POLICY IF EXISTS tax_invoice_insert ON tax_invoice;
DROP POLICY IF EXISTS tax_invoice_update ON tax_invoice;
CREATE POLICY tax_invoice_select ON tax_invoice FOR SELECT USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY tax_invoice_insert ON tax_invoice FOR INSERT WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY tax_invoice_update ON tax_invoice FOR UPDATE USING (current_user_has_book_role(book, 'staff')) WITH CHECK (current_user_has_book_role(book, 'staff'));

-- ------------------------------------------------------------
-- record_sale_tax_invoice — 발행 결과 기록(멱등: book+mgt_key) + sale 동기화
--   발행 상태(issued/nts_sent/nts_approved)면 sale.tax_invoice_issued_on·tax_doc_no 갱신
--   → 라이프사이클 계산서 단계 자동 반영.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_sale_tax_invoice(p_sale_id uuid, p_invoice jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
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
BEGIN
  SELECT book INTO v_book FROM sale WHERE id = p_sale_id AND deleted_at IS NULL;
  IF v_book IS NULL THEN RAISE EXCEPTION '매출을 찾을 수 없습니다'; END IF;
  IF v_book = 'b' THEN RAISE EXCEPTION 'B계좌는 세금계산서를 발행할 수 없습니다'; END IF;
  IF v_mgt IS NULL OR v_mgt = '' THEN RAISE EXCEPTION '문서관리번호(mgt_key)가 필요합니다'; END IF;

  v_issued := v_state IN ('issued','nts_sent','nts_approved');

  SELECT id INTO v_id FROM tax_invoice
    WHERE book = v_book AND mgt_key = v_mgt AND deleted_at IS NULL;

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
GRANT EXECUTE ON FUNCTION record_sale_tax_invoice(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- cancel_sale_tax_invoice — 발행 취소(state='cancelled') + sale 발행 필드 클리어
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_sale_tax_invoice(p_sale_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE tax_invoice SET
    state  = 'cancelled',
    remark = COALESCE(remark,'') ||
             CASE WHEN COALESCE(p_reason,'') = '' THEN '' ELSE ' [취소: ' || p_reason || ']' END
  WHERE sale_id = p_sale_id AND deleted_at IS NULL AND state <> 'cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION '취소할 세금계산서가 없습니다'; END IF;

  UPDATE sale SET tax_invoice_issued_on = NULL, tax_doc_no = NULL
    WHERE id = p_sale_id AND deleted_at IS NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_sale_tax_invoice(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- update_tax_invoice_state — ASP 상태조회 결과 반영(+승인번호 동기화)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_tax_invoice_state(p_sale_id uuid, p_state text, p_nts text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_state tax_invoice_state := p_state::tax_invoice_state;
BEGIN
  UPDATE tax_invoice SET
    state           = v_state,
    nts_confirm_num = COALESCE(NULLIF(p_nts,''), nts_confirm_num),
    issued_at       = COALESCE(issued_at, CASE WHEN v_state IN ('issued','nts_sent','nts_approved') THEN NOW() ELSE NULL END)
  WHERE sale_id = p_sale_id AND deleted_at IS NULL AND state <> 'cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION '세금계산서를 찾을 수 없습니다'; END IF;

  IF v_state IN ('issued','nts_sent','nts_approved') AND NULLIF(p_nts,'') IS NOT NULL THEN
    UPDATE sale SET tax_doc_no = p_nts WHERE id = p_sale_id AND deleted_at IS NULL;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION update_tax_invoice_state(uuid, text, text) TO authenticated;
