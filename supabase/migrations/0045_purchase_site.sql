-- ============================================================
-- 0045_purchase_site.sql
-- 매입에 현장(site) 추가 — 매출(sale.site_id/site_name, 0031) 패턴 미러.
-- 중고·해체 철근이 '어느 현장에서 나왔는지' 기록(현장과 거래처는 분리, 도메인 룰).
-- ============================================================

ALTER TABLE purchase ADD COLUMN IF NOT EXISTS site_id   UUID REFERENCES site(id);
ALTER TABLE purchase ADD COLUMN IF NOT EXISTS site_name TEXT;
CREATE INDEX IF NOT EXISTS idx_purchase_site ON purchase(site_id) WHERE deleted_at IS NULL;

-- create_purchase_with_line RPC 갱신 — 헤더에 site_id/site_name 추가(0043 본문 + site).
CREATE OR REPLACE FUNCTION create_purchase_with_line(p_purchase jsonb, p_line jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_purchase_id uuid;
  v_book        book_type := (p_purchase->>'book')::book_type;
  v_status      purchase_status := (p_purchase->>'status')::purchase_status;
BEGIN
  INSERT INTO purchase (
    book, doc_no, partner_id, site_id, site_name, purchase_subtype,
    ordered_on, delivered_on, is_documented, tax_doc_type, tax_doc_no, vat_type, vat_rate,
    subtotal_krw, vat_krw, total_krw, payment_due_on, paid_on, status, notes
  ) VALUES (
    v_book,
    p_purchase->>'doc_no',
    (p_purchase->>'partner_id')::uuid,
    NULLIF(p_purchase->>'site_id','')::uuid,
    NULLIF(p_purchase->>'site_name',''),
    'external',
    (p_purchase->>'ordered_on')::date,
    NULLIF(p_purchase->>'delivered_on','')::date,
    (p_purchase->>'is_documented')::boolean,
    (p_purchase->>'tax_doc_type')::tax_doc_type,
    NULLIF(p_purchase->>'tax_doc_no',''),
    (p_purchase->>'vat_type')::vat_type,
    (p_purchase->>'vat_rate')::numeric,
    (p_purchase->>'subtotal_krw')::numeric,
    (p_purchase->>'vat_krw')::numeric,
    (p_purchase->>'total_krw')::numeric,
    NULLIF(p_purchase->>'payment_due_on','')::date,
    NULLIF(p_purchase->>'paid_on','')::date,
    v_status,
    NULLIF(p_purchase->>'notes','')
  )
  RETURNING id INTO v_purchase_id;

  INSERT INTO purchase_line (
    purchase_id, book, warehouse_id, warehouse_zone_id, item_id,
    acquired_unit, acquired_qty, unit_price_krw, bars_count,
    theoretical_weight_kg, actual_weight_kg, invoiced_weight_kg,
    price_basis, line_subtotal_krw, status
  ) VALUES (
    v_purchase_id,
    v_book,
    (p_line->>'warehouse_id')::uuid,
    NULLIF(p_line->>'warehouse_zone_id','')::uuid,
    (p_line->>'item_id')::uuid,
    (p_line->>'acquired_unit')::acquired_unit,
    (p_line->>'acquired_qty')::numeric,
    (p_line->>'unit_price_krw')::numeric,
    NULLIF(p_line->>'bars_count','')::int,
    NULLIF(p_line->>'theoretical_weight_kg','')::numeric,
    NULLIF(p_line->>'actual_weight_kg','')::numeric,
    NULLIF(p_line->>'invoiced_weight_kg','')::numeric,
    (p_line->>'price_basis')::price_basis,
    (p_line->>'line_subtotal_krw')::numeric,
    (p_line->>'line_status')::purchase_status
  );

  RETURN v_purchase_id;
END;
$$;
