-- ============================================================
-- 0088_partner_document.sql
-- 거래처 사업자 이미지 — 사업자등록증·계산서 사진을 거래처 데이터에 함께 둔다(2026-10-27 사용자 요청).
--   · 거래처 등록에서 이미지를 올리면 AI 가 읽어 자동 등록하고(앱), 올린 이미지는 이 표에 남긴다.
--     수정 화면에서 더 올리거나 뺄 수 있다.
--   · 파일은 비공개 버킷 'partner-docs' — 공개 URL 이 없고, 화면은 서버가 만든 짧은 서명 URL 로만 보여 준다.
--     계산서엔 거래 금액이, 사업자등록증엔 대표자 정보가 있어 공개 버킷('attachments')에 두지 않는다.
--   · 권한은 거래처 마스터와 같다(0019): 보기 = 로그인 사용자, 올리기·빼기 = 어느 책이든 owner/manager.
--     고치기는 없다(UPDATE 정책 없음 = 거부) — 바꾸려면 빼고 다시 올린다.
--   · 거래처는 soft delete(deleted_at)라 이미지 행은 남는다. 거래처 행을 실제로 지우면 같이 지워진다(CASCADE) —
--     그때 버킷 파일은 남으니 지우는 쪽(스크립트)이 파일도 정리한다.
-- ============================================================

CREATE TABLE IF NOT EXISTS partner_document (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'other',      -- biz_cert(사업자등록증) · tax_invoice(계산서) · other
  path        text NOT NULL UNIQUE,               -- 'partner-docs' 버킷 안 경로: <partner_id>/<시각>-<난수>.jpg
  mime        text,
  bytes       integer,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT auth.uid(),            -- FK 없음: user_profile 과 이어 PostgREST 임베드가 모호해지지 않게
  CONSTRAINT chk_partner_document_kind CHECK (kind IN ('biz_cert', 'tax_invoice', 'other'))
);
COMMENT ON TABLE partner_document IS '거래처 사업자 이미지(사업자등록증·계산서 사진) — 파일은 비공개 버킷 partner-docs (0088)';

CREATE INDEX IF NOT EXISTS idx_partner_document_partner ON partner_document (partner_id, sort_order, created_at);

ALTER TABLE partner_document ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partner_document FROM anon;

DROP POLICY IF EXISTS p_partner_document_read   ON partner_document;
DROP POLICY IF EXISTS p_partner_document_insert ON partner_document;
DROP POLICY IF EXISTS p_partner_document_delete ON partner_document;

CREATE POLICY p_partner_document_read ON partner_document FOR SELECT TO authenticated
  USING (p_master_select_check());
CREATE POLICY p_partner_document_insert ON partner_document FOR INSERT TO authenticated
  WITH CHECK (
    p_master_write_check()
    AND EXISTS (SELECT 1 FROM partner p WHERE p.id = partner_id AND p.deleted_at IS NULL)
  );
CREATE POLICY p_partner_document_delete ON partner_document FOR DELETE TO authenticated
  USING (p_master_write_check());

-- ============================================================
-- 비공개 버킷 'partner-docs' (5MB, 이미지 3종) — 앱은 올리기 전에 긴 변 2000px JPEG 로 줄인다.
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('partner-docs', 'partner-docs', FALSE, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS p_partner_docs_read   ON storage.objects;
DROP POLICY IF EXISTS p_partner_docs_insert ON storage.objects;
DROP POLICY IF EXISTS p_partner_docs_delete ON storage.objects;

CREATE POLICY p_partner_docs_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'partner-docs');
CREATE POLICY p_partner_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'partner-docs' AND public.p_master_write_check());
CREATE POLICY p_partner_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'partner-docs' AND public.p_master_write_check());

-- PostgREST schema cache 강제 reload
NOTIFY pgrst, 'reload schema';
