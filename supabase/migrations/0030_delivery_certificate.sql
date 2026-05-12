-- ============================================================
-- 0030_delivery_certificate.sql
-- 납품확인서 (Delivery Certificate).
-- 도메인 룰: 철근 납품이 단 1원이라도 있었으면 의무 발급. 자료/무자료 무관.
-- 거래처+현장 단위로 1회 발급. 준공검사 첨부 필수 → 거래처 미수 안전장치.
-- 사업자 인감 첨부는 v1.1 (stamp_url).
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_certificate (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book         book_type NOT NULL,
  partner_id   UUID NOT NULL REFERENCES partner(id) ON DELETE RESTRICT,
  site_name    TEXT,                                    -- NULL = 현장 미지정 (거래처 단위)
  doc_no       TEXT NOT NULL UNIQUE,                    -- DC-YYYY-NNNN
  issued_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  issued_by    UUID REFERENCES user_profile(user_id),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES user_profile(user_id),
  deleted_at   TIMESTAMPTZ
);

-- 1회 발급 룰: (book, partner_id, site_name) 조합 UNIQUE
-- site_name NULL은 빈 문자열로 동등 처리 → '현장 미지정' 도 1장만 허용
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_cert_partner_site
  ON delivery_certificate (book, partner_id, COALESCE(site_name, ''))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_cert_partner
  ON delivery_certificate(partner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_cert_book
  ON delivery_certificate(book) WHERE deleted_at IS NULL;

-- updated_at 자동
DROP TRIGGER IF EXISTS trg_delivery_cert_updated_at ON delivery_certificate;
CREATE TRIGGER trg_delivery_cert_updated_at
  BEFORE UPDATE ON delivery_certificate
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- audit log
DROP TRIGGER IF EXISTS trg_audit_delivery_cert ON delivery_certificate;
CREATE TRIGGER trg_audit_delivery_cert
  AFTER INSERT OR UPDATE OR DELETE ON delivery_certificate
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- RLS
ALTER TABLE delivery_certificate ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_delivery_cert_read   ON delivery_certificate;
DROP POLICY IF EXISTS p_delivery_cert_insert ON delivery_certificate;
DROP POLICY IF EXISTS p_delivery_cert_update ON delivery_certificate;
DROP POLICY IF EXISTS p_delivery_cert_delete ON delivery_certificate;

CREATE POLICY p_delivery_cert_read ON delivery_certificate FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));

CREATE POLICY p_delivery_cert_insert ON delivery_certificate FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));

CREATE POLICY p_delivery_cert_update ON delivery_certificate FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));

CREATE POLICY p_delivery_cert_delete ON delivery_certificate FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- sale.delivery_cert_id — 어느 확인서에 포함됐는지
ALTER TABLE sale ADD COLUMN IF NOT EXISTS delivery_cert_id UUID
  REFERENCES delivery_certificate(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sale_delivery_cert
  ON sale(delivery_cert_id) WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
