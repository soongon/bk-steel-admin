-- ============================================================
-- 0100_inquiry_document.sql
-- 문의 사진(inquiry_document) — 문의 상세에도 사진을 붙인다(2026-11-05 사용자 요청, 0099 sale/purchase_document 와 같은 구조).
--   · 문의 원본은 홈페이지 전용 Supabase(다른 프로젝트)의 inquiries — FK 를 걸 수 없어 inquiry_id 는 uuid 값만 저장한다
--     (0098 inquiry_memo 와 같음). 문의가 있는지는 어드민 서버 액션이 확인하고, 문의를 지울 때 purge_inquiry_documents 로 같이 지운다.
--   · 종류 = site(현장) · goods(물건: 팔려는 철근·자재 사진) · material(자료: 도면·물량표). 계근표·영수증은 거래 쪽 종류.
--   · 권한은 문의 메모와 같다(책과 무관한 공유 영역): 보기 = 어느 책이든 역할이 있으면, 올리기 = 어느 책이든 staff 이상,
--     빼기 = 올린 본인 + 지금도 staff 이상. 고치기 없음.
--   · 파일은 같은 비공개 버킷 'trade-docs', 경로 = inquiry/<문의 id>/<시각>-<난수>.jpg. 버킷 정책의 경로 함수에 inquiry 가지를 더한다.
--   · 버킷 지우기: 문의 경로는 올린 본인이 아니어도 staff 이상이면 지울 수 있게 한다 — 문의 삭제 때 남이 올린 파일까지 정리해야
--     하는데 어드민 DB 엔 서비스 롤 클라이언트가 없다(표 행은 여전히 본인만 — 화면의 [빼기]는 표 정책이 막는다).
-- ============================================================

CREATE TABLE IF NOT EXISTS inquiry_document (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id  uuid NOT NULL,                       -- 홈페이지 DB inquiries.id (다른 프로젝트라 FK 없음)
  kind        text NOT NULL,                       -- site(현장) · goods(물건) · material(자료)
  path        text NOT NULL UNIQUE,                -- 'trade-docs' 버킷 안 경로: inquiry/<inquiry_id>/<시각>-<난수>.jpg
  mime        text,
  bytes       integer,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES user_profile(user_id) ON DELETE SET NULL,
  CONSTRAINT chk_inquiry_document_kind CHECK (kind IN ('site', 'goods', 'material')),
  CONSTRAINT chk_inquiry_document_path CHECK (path LIKE 'inquiry/' || inquiry_id::text || '/%')
);
COMMENT ON TABLE inquiry_document IS '문의 사진(현장·물건·자료) — 파일은 비공개 버킷 trade-docs, 권한은 문의 메모와 같음(책 무관), inquiry_id 는 홈페이지 DB 값 (0100)';

CREATE INDEX IF NOT EXISTS idx_inquiry_document_inquiry ON inquiry_document (inquiry_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_inquiry_document_created_by ON inquiry_document (created_by) WHERE created_by IS NOT NULL;

-- 올린 시각·올린 사람 — 0099 의 공용 트리거 함수 그대로.
DROP TRIGGER IF EXISTS trg_inquiry_document_fill ON inquiry_document;
CREATE TRIGGER trg_inquiry_document_fill
  BEFORE INSERT ON inquiry_document
  FOR EACH ROW EXECUTE FUNCTION trade_document_fill();

-- ---------- RLS: 표(0098 inquiry_memo 와 같은 기준) ----------
ALTER TABLE inquiry_document ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inquiry_document FROM anon;

DROP POLICY IF EXISTS p_inquiry_document_read   ON inquiry_document;
DROP POLICY IF EXISTS p_inquiry_document_insert ON inquiry_document;
DROP POLICY IF EXISTS p_inquiry_document_delete ON inquiry_document;

CREATE POLICY p_inquiry_document_read ON inquiry_document FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_book_role r WHERE r.user_id = (SELECT auth.uid())));

CREATE POLICY p_inquiry_document_insert ON inquiry_document FOR INSERT
  WITH CHECK (created_by = (SELECT auth.uid()) AND current_user_has_any_staff_role());

CREATE POLICY p_inquiry_document_delete ON inquiry_document FOR DELETE
  USING (created_by = (SELECT auth.uid()) AND current_user_has_any_staff_role());

-- ---------- 버킷 'trade-docs' 경로 함수에 inquiry 가지 ----------
-- inquiry/<uuid>/… 는 어느 책이든 staff 이상이면 쓸 수 있다(문의가 실제로 있는지는 서버 액션이 홈페이지 DB 에서 확인).
CREATE OR REPLACE FUNCTION trade_document_path_writable(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parts text[] := storage.foldername(p_name);
  v_id uuid;
BEGIN
  IF array_length(v_parts, 1) <> 2 OR v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  v_id := v_parts[2]::uuid;
  IF v_parts[1] = 'sale' THEN
    RETURN EXISTS (SELECT 1 FROM sale s WHERE s.id = v_id AND s.deleted_at IS NULL AND current_user_has_book_role(s.book, 'staff'));
  ELSIF v_parts[1] = 'purchase' THEN
    RETURN EXISTS (SELECT 1 FROM purchase p WHERE p.id = v_id AND p.deleted_at IS NULL AND current_user_has_book_role(p.book, 'staff'));
  ELSIF v_parts[1] = 'inquiry' THEN
    RETURN current_user_has_any_staff_role();
  END IF;
  RETURN false;
END;
$$;

-- 읽기: 0099 두 조건 + 문의 사진 행이 보이면 + 문의 경로는 staff 이상이면 행이 없어도(지우기 정책과 같은 폭 — DELETE 는
-- WHERE/RETURNING 때문에 SELECT 정책도 통과해야 하므로, 문의 삭제 때 행을 먼저 지운 뒤 남이 올린 파일을 지우려면 이 가지가 필요).
DROP POLICY IF EXISTS p_trade_docs_read ON storage.objects;
CREATE POLICY p_trade_docs_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trade-docs'
    AND (
      ((owner_id = (SELECT auth.uid())::text OR name LIKE 'inquiry/%') AND public.trade_document_path_writable(name))
      OR EXISTS (SELECT 1 FROM public.sale_document d WHERE d.path = name)
      OR EXISTS (SELECT 1 FROM public.purchase_document d WHERE d.path = name)
      OR EXISTS (SELECT 1 FROM public.inquiry_document d WHERE d.path = name)
    )
  );

-- 지우기: 거래 경로는 올린 본인(0099 그대로), 문의 경로는 staff 이상이면 누구나(문의 삭제 때 남의 파일까지 정리하기 위해).
DROP POLICY IF EXISTS p_trade_docs_delete ON storage.objects;
CREATE POLICY p_trade_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'trade-docs'
    AND (owner_id = (SELECT auth.uid())::text OR name LIKE 'inquiry/%')
    AND public.trade_document_path_writable(name)
  );

-- 문의 삭제 때 그 문의의 사진 행을 모두 지우고(남이 올린 것 포함) 파일 경로를 돌려준다 — 앱이 버킷에서 파일을 지운다.
-- staff 이상만(purge_inquiry_memos 와 같은 기준).
CREATE OR REPLACE FUNCTION purge_inquiry_documents(p_inquiry_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT current_user_has_any_staff_role() THEN
    RAISE EXCEPTION '권한이 없습니다 (staff 이상 필요).' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY DELETE FROM inquiry_document WHERE inquiry_id = p_inquiry_id RETURNING path;
END;
$$;
REVOKE EXECUTE ON FUNCTION purge_inquiry_documents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION purge_inquiry_documents(uuid) TO authenticated;

-- PostgREST schema cache 강제 reload
NOTIFY pgrst, 'reload schema';
