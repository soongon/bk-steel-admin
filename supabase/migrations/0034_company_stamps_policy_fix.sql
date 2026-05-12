-- ============================================================
-- 0034_company_stamps_policy_fix.sql
-- Storage 정책 수정: auth.uid() IS NOT NULL → auth.role() = 'authenticated'
-- (Supabase Storage 권장 패턴 — server action 컨텍스트에서 안정적)
-- ============================================================

DROP POLICY IF EXISTS p_company_stamps_insert ON storage.objects;
DROP POLICY IF EXISTS p_company_stamps_update ON storage.objects;
DROP POLICY IF EXISTS p_company_stamps_delete ON storage.objects;

CREATE POLICY p_company_stamps_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'company-stamps' AND auth.role() = 'authenticated');

CREATE POLICY p_company_stamps_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'company-stamps' AND auth.role() = 'authenticated')
  WITH CHECK (bucket_id = 'company-stamps' AND auth.role() = 'authenticated');

CREATE POLICY p_company_stamps_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'company-stamps' AND auth.role() = 'authenticated');
