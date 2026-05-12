-- ============================================================
-- 0031_site.sql
-- 현장(Site) 마스터.
-- 결정: 독립 마스터 (partner와 M:N) — 한 현장에 여러 거래처(시공사·하청·자재상) 등장 가능.
-- partner 처럼 글로벌 (book 컬럼 없음) — BK/SL/B 모두 공유.
-- 기존 sale.site_name 자유 텍스트 데이터를 distinct 로 자동 시드.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS site_code_seq START 1;

CREATE TABLE IF NOT EXISTS site (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL DEFAULT 'S-' || LPAD(nextval('site_code_seq')::text, 4, '0'),
  name          TEXT NOT NULL,
  address       TEXT,
  city          TEXT,                                        -- 지역 (목록 그룹·검색)
  client_name   TEXT,                                        -- 시공사·발주처 메모 (free text — partner와 분리)
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'closed')),
  started_on    DATE,
  ended_on      DATE,
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  created_by    UUID REFERENCES user_profile(user_id),
  updated_by    UUID REFERENCES user_profile(user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_site_name ON site(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_site_active ON site(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_site_status ON site(status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_site_updated_at ON site;
CREATE TRIGGER trg_site_updated_at
  BEFORE UPDATE ON site FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_site ON site;
CREATE TRIGGER trg_audit_site
  AFTER INSERT OR UPDATE OR DELETE ON site
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- RLS: partner와 동일 패턴 — 인증 사용자 SELECT, owner/manager만 변경
ALTER TABLE site ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_site_read   ON site;
DROP POLICY IF EXISTS p_site_insert ON site;
DROP POLICY IF EXISTS p_site_update ON site;
DROP POLICY IF EXISTS p_site_delete ON site;

CREATE POLICY p_site_read ON site FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY p_site_insert ON site FOR INSERT
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_site_update ON site FOR UPDATE
  USING (current_user_is_owner_or_manager_any_book())
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_site_delete ON site FOR DELETE
  USING (current_user_is_owner_or_manager_any_book());

-- sale.site_id, delivery_certificate.site_id 추가
ALTER TABLE sale ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES site(id);
CREATE INDEX IF NOT EXISTS idx_sale_site ON sale(site_id) WHERE deleted_at IS NULL;

ALTER TABLE delivery_certificate ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES site(id);
CREATE INDEX IF NOT EXISTS idx_delivery_cert_site_id
  ON delivery_certificate(site_id) WHERE deleted_at IS NULL;

-- 데이터 마이그레이션: sale.site_name distinct → site 자동 시드
INSERT INTO site (name)
SELECT DISTINCT TRIM(site_name)
FROM sale
WHERE site_name IS NOT NULL
  AND TRIM(site_name) <> ''
  AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- sale.site_id 채우기 (site_name 매칭)
UPDATE sale SET site_id = site.id
FROM site
WHERE TRIM(COALESCE(sale.site_name, '')) = site.name
  AND sale.site_id IS NULL
  AND sale.deleted_at IS NULL;

-- delivery_certificate.site_id 채우기
UPDATE delivery_certificate dc SET site_id = s.id
FROM site s
WHERE TRIM(COALESCE(dc.site_name, '')) = s.name
  AND dc.site_id IS NULL
  AND dc.deleted_at IS NULL;

-- delivery_certificate UNIQUE 갱신: site_name → site_id 기준
-- (도메인 룰 1회 발급 단위가 site_id 기준으로 정확해짐 — 이름 변경에도 동일 현장 인식)
DROP INDEX IF EXISTS uq_delivery_cert_partner_site;
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_cert_partner_site_id
  ON delivery_certificate (book, partner_id, COALESCE(site_id::text, ''))
  WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
