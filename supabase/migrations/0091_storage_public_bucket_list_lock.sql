-- ============================================================
-- 0091_storage_public_bucket_list_lock.sql
-- 공개 버킷(attachments·company-stamps)의 익명 목록 조회 막기(2026-10-27 사용자 요청).
--   · 두 버킷의 SELECT 정책에 역할 제한이 없어(USING bucket_id = …) anon 키(브라우저 번들에 공개)로 Storage API 의
--     목록(list)을 부르면 파일 경로가 나왔다 → 명함·영수증·알림 이미지, 인감·통장사본·사업자등록증 경로를 알아내
--     공개 URL 로 내려받을 수 있었다.
--   · 공개 버킷의 공개 URL(/storage/v1/object/public/…) 내려받기는 이 정책을 거치지 않는다 — 화면·문자·카카오워크
--     이미지 링크는 그대로 열린다. 목록·서명 URL 같은 API 조회만 로그인 사용자로 좁힌다.
--   · 앱은 로그인 세션(서버 액션) 또는 service role(정리 스크립트)로만 이 버킷을 쓴다. 올리기·지우기 정책은 그대로.
--   · 번호: 원격 이력 0089 는 다른 작업(replace_sale_lines, 그쪽 파일은 0090)이 먼저 썼다 — 겹치지 않게 0091.
-- ============================================================

DROP POLICY IF EXISTS p_attachments_read ON storage.objects;
CREATE POLICY p_attachments_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attachments');

DROP POLICY IF EXISTS p_company_stamps_read ON storage.objects;
CREATE POLICY p_company_stamps_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-stamps');
