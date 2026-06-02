-- ============================================================
-- 0041_sale_integrity.sql
-- 매출 무결성 — 원자적 생성 RPC · 삭제 권한 강제 RPC · 법인 자료종류 CHECK 강화
-- 참조: Codex 감사(2026-06) Critical 1·2·3
-- ============================================================

-- ------------------------------------------------------------
-- 1) 원자적 매출 생성 — 헤더 + 라인 한 트랜잭션
--    분리 insert 시 라인 실패하면 헤더만 남는 부분 매출이 생기던 문제 해결.
--    SECURITY INVOKER → 호출자 RLS·CHECK 그대로 적용(staff insert 정책, bk/b 자료성 CHECK).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_sale_with_line(p_sale jsonb, p_line jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_book    book_type := (p_sale->>'book')::book_type;
  v_status  sale_status := (p_sale->>'status')::sale_status;
BEGIN
  INSERT INTO sale (
    book, doc_no, partner_id, site_id, site_name, sale_subtype,
    ordered_on, delivered_on, is_documented, tax_doc_type, vat_type, vat_rate,
    subtotal_krw, vat_krw, total_krw, payment_due_on, settled_on, status, notes
  ) VALUES (
    v_book,
    p_sale->>'doc_no',
    (p_sale->>'partner_id')::uuid,
    NULLIF(p_sale->>'site_id','')::uuid,
    NULLIF(p_sale->>'site_name',''),
    'external',
    (p_sale->>'ordered_on')::date,
    NULLIF(p_sale->>'delivered_on','')::date,
    (p_sale->>'is_documented')::boolean,
    (p_sale->>'tax_doc_type')::tax_doc_type,
    (p_sale->>'vat_type')::vat_type,
    (p_sale->>'vat_rate')::numeric,
    (p_sale->>'subtotal_krw')::numeric,
    (p_sale->>'vat_krw')::numeric,
    (p_sale->>'total_krw')::numeric,
    NULLIF(p_sale->>'payment_due_on','')::date,
    NULLIF(p_sale->>'settled_on','')::date,
    v_status,
    NULLIF(p_sale->>'notes','')
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO sale_line (
    sale_id, book, item_id, unit, qty, unit_price_krw,
    weight_kg, theoretical_weight_kg, price_basis, line_subtotal_krw, status
  ) VALUES (
    v_sale_id,
    v_book,
    (p_line->>'item_id')::uuid,
    (p_line->>'unit')::acquired_unit,
    (p_line->>'qty')::numeric,
    (p_line->>'unit_price_krw')::numeric,
    NULLIF(p_line->>'weight_kg','')::numeric,
    NULLIF(p_line->>'weight_kg','')::numeric,
    'theoretical',
    (p_line->>'line_subtotal_krw')::numeric,
    v_status
  );

  RETURN v_sale_id;
END;
$$;

-- ------------------------------------------------------------
-- 2) 매출 soft-delete — manager 이상만.
--    기존엔 actions가 deleted_at UPDATE라 staff UPDATE 정책으로 우회됐음.
--    SECURITY INVOKER + 명시적 manager 체크로 삭제 권한을 실제로 강제.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_sale(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_book book_type;
BEGIN
  SELECT book INTO v_book FROM sale WHERE id = p_id AND deleted_at IS NULL;
  IF v_book IS NULL THEN
    RAISE EXCEPTION '매출을 찾을 수 없습니다';
  END IF;
  IF NOT current_user_has_book_role(v_book, 'manager') THEN
    RAISE EXCEPTION '삭제 권한이 없습니다 (manager 이상 필요)';
  END IF;
  UPDATE sale SET deleted_at = NOW() WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_sale_with_line(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION soft_delete_sale(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3) 법인(bk) 자료종류 CHECK 강화 — "법인은 100% 정상거래"
--    is_documented=TRUE 만으로는 tax_doc_type='none'/'simple_receipt' 조합을 못 막았음.
--    (적용 전 점검: 위반 행 0건 확인)
-- ------------------------------------------------------------
ALTER TABLE sale DROP CONSTRAINT IF EXISTS chk_bk_documented_sale;
ALTER TABLE sale ADD CONSTRAINT chk_bk_documented_sale CHECK (
  book <> 'bk'
  OR (is_documented = TRUE AND tax_doc_type NOT IN ('none', 'simple_receipt'))
);
