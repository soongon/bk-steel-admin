-- ============================================================
-- 0077_purchase_quote_business_card.sql
-- 매입견적서 판매자 명함 이미지 — 공용 첨부(attachment, 0035)에 entity_type 'purchase_quote' 를 허용한다.
--   · 파일은 기존 'attachments' 버킷(공개, 5MB, png/jpeg/webp), 메타는 attachment 행(kind = 'business_card').
--   · 첨부 권한은 0035 그대로(로그인 사용자) — 견적 본체 권한은 purchase_quote RLS 가 강제한다.
--   · 기존 허용값을 모두 유지하는 확장이라 기존 행 검증은 그대로 통과한다.
-- ============================================================

ALTER TABLE attachment DROP CONSTRAINT IF EXISTS chk_attachment_entity_type;
ALTER TABLE attachment ADD CONSTRAINT chk_attachment_entity_type CHECK (entity_type IN (
  'business_card','sales_log','sale','purchase','receipt','purchase_quote'
));

-- PostgREST schema cache 강제 reload
NOTIFY pgrst, 'reload schema';
