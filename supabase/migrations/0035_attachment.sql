-- ============================================================
-- 0035_attachment.sql
-- 폴리모픽 첨부 테이블 — 모든 엔티티(명함·영업내역·매출·매입·영수증)에서 공용
-- 사진/스캔본 메타 보관, 실제 파일은 Supabase Storage 'attachments' 버킷에 저장.
-- storage 컬럼으로 추후 다른 백엔드(Cloudinary 등) 갈아끼울 여지 보존.
-- ============================================================

CREATE TABLE IF NOT EXISTS attachment (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  kind          TEXT,                              -- 'front','back','photo','receipt_scan','invoice_scan' 등
  storage       TEXT NOT NULL DEFAULT 'supabase',
  path          TEXT,                              -- 백엔드 내부 식별자 (Supabase: bucket 내 경로)
  url           TEXT NOT NULL,                     -- 공개 URL
  thumbnail_url TEXT,
  mime          TEXT,
  bytes         INT,
  width         INT,
  height        INT,
  caption       TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES user_profile(user_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,

  CONSTRAINT chk_attachment_entity_type CHECK (entity_type IN (
    'business_card','sales_log','sale','purchase','receipt'
  )),
  CONSTRAINT chk_attachment_storage CHECK (storage IN ('supabase','cloudinary'))
);

CREATE INDEX IF NOT EXISTS idx_attachment_entity ON attachment(entity_type, entity_id, sort_order)
  WHERE deleted_at IS NULL;

-- RLS — entity 본체에서 권한이 강제되므로 attachment는 단순 인증 체크만
ALTER TABLE attachment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_attachment_select ON attachment;
DROP POLICY IF EXISTS p_attachment_insert ON attachment;
DROP POLICY IF EXISTS p_attachment_update ON attachment;
DROP POLICY IF EXISTS p_attachment_delete ON attachment;

CREATE POLICY p_attachment_select ON attachment FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY p_attachment_insert ON attachment FOR INSERT
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY p_attachment_update ON attachment FOR UPDATE
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY p_attachment_delete ON attachment FOR DELETE
  USING ((SELECT auth.uid()) IS NOT NULL);

-- ============================================================
-- Storage 버킷 'attachments' (5MB, 이미지 3종)
-- 인감(company-stamps)과 동일한 패턴: public 버킷 + 인증 사용자만 변경
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  TRUE,
  5242880,                                              -- 5MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS p_attachments_read   ON storage.objects;
DROP POLICY IF EXISTS p_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS p_attachments_update ON storage.objects;
DROP POLICY IF EXISTS p_attachments_delete ON storage.objects;

CREATE POLICY p_attachments_read ON storage.objects FOR SELECT
  USING (bucket_id = 'attachments');

CREATE POLICY p_attachments_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'attachments' AND auth.role() = 'authenticated');

CREATE POLICY p_attachments_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'attachments' AND auth.role() = 'authenticated')
  WITH CHECK (bucket_id = 'attachments' AND auth.role() = 'authenticated');

CREATE POLICY p_attachments_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'attachments' AND auth.role() = 'authenticated');

-- PostgREST schema cache 강제 reload
NOTIFY pgrst, 'reload schema';
