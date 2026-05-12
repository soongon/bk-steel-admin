-- ============================================================
-- 0033_company_stamps_storage.sql
-- 회사 인감(직인) 이미지 저장용 Supabase Storage 버킷.
-- 거래명세표·납품확인서에 표시 → 어차피 외부 인쇄물에 노출되므로 public 버킷.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-stamps',
  'company-stamps',
  TRUE,
  1048576,                                              -- 1MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: 모두 SELECT (public 버킷), 인증 사용자만 변경
DROP POLICY IF EXISTS p_company_stamps_read   ON storage.objects;
DROP POLICY IF EXISTS p_company_stamps_insert ON storage.objects;
DROP POLICY IF EXISTS p_company_stamps_update ON storage.objects;
DROP POLICY IF EXISTS p_company_stamps_delete ON storage.objects;

CREATE POLICY p_company_stamps_read ON storage.objects FOR SELECT
  USING (bucket_id = 'company-stamps');

CREATE POLICY p_company_stamps_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'company-stamps' AND auth.uid() IS NOT NULL);

CREATE POLICY p_company_stamps_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'company-stamps' AND auth.uid() IS NOT NULL);

CREATE POLICY p_company_stamps_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'company-stamps' AND auth.uid() IS NOT NULL);
