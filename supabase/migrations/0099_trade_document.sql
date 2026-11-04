-- ============================================================
-- 0099_trade_document.sql
-- 매출·매입 사진(sale_document·purchase_document) — 계근표·현장·영수증 사진을 거래에 붙인다(2026-11-04 사용자 요청).
--   · 기존 attachment(0035)·공개 버킷 'attachments' 는 쓰지 않는다: 공개 URL 은 로그인 없이 열리고, attachment 행은
--     "로그인만 하면 전부" 라 매출·매입의 책 권한(B계좌 격리)이 걸리지 않는다. 거래 사진엔 금액·상대방이 찍힌다.
--   · 메모 기록(0080·0081)과 같은 구조: 책 컬럼 없이 거래를 조인한다. 보기 = 그 거래가 보이면(거래 RLS = 그 책
--     viewer 이상, B계좌 격리 그대로), 올리기 = 지워지지 않은 거래 + 그 책 staff 이상, 빼기 = 올린 본인(지금도 staff).
--     고치기 없음(UPDATE 정책 없음 = 거부) — 종류를 바꾸려면 빼고 다시 올린다.
--   · 파일은 비공개 버킷 'trade-docs'(거래처 이미지 0088 과 같은 방식) — 화면은 서버가 만든 짧은 서명 URL 로만.
--     경로 = <sale|purchase>/<거래 id>/<시각>-<난수>.jpg. 버킷 정책도 이 경로의 거래를 조인한다.
--   · 올린 시각·올린 사람은 트리거가 채운다(클라이언트 값 무시).
--   · 거래는 soft delete(deleted_at)라 사진 행·파일은 남는다(삭제 거래 상세는 안 열리므로 보이는 곳 없음).
--     거래 행을 실제로 지우면 행은 CASCADE — 그때 파일은 지우는 쪽(스크립트)이 정리한다.
-- ============================================================

-- ---------- sale_document ----------
CREATE TABLE IF NOT EXISTS sale_document (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     uuid NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
  kind        text NOT NULL,                       -- weigh(계근표) · site(현장) · receipt(영수증·송금)
  path        text NOT NULL UNIQUE,                -- 'trade-docs' 버킷 안 경로: sale/<sale_id>/<시각>-<난수>.jpg
  mime        text,
  bytes       integer,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES user_profile(user_id) ON DELETE SET NULL,
  CONSTRAINT chk_sale_document_kind CHECK (kind IN ('weigh', 'site', 'receipt')),
  CONSTRAINT chk_sale_document_path CHECK (path LIKE 'sale/' || sale_id::text || '/%')
);
COMMENT ON TABLE sale_document IS '매출 사진(계근표·현장·영수증) — 파일은 비공개 버킷 trade-docs, 권한은 매출을 따라감 (0099)';

CREATE INDEX IF NOT EXISTS idx_sale_document_sale ON sale_document (sale_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_sale_document_created_by ON sale_document (created_by) WHERE created_by IS NOT NULL;

-- ---------- purchase_document ----------
CREATE TABLE IF NOT EXISTS purchase_document (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id  uuid NOT NULL REFERENCES purchase(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  path         text NOT NULL UNIQUE,               -- purchase/<purchase_id>/<시각>-<난수>.jpg
  mime         text,
  bytes        integer,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES user_profile(user_id) ON DELETE SET NULL,
  CONSTRAINT chk_purchase_document_kind CHECK (kind IN ('weigh', 'site', 'receipt')),
  CONSTRAINT chk_purchase_document_path CHECK (path LIKE 'purchase/' || purchase_id::text || '/%')
);
COMMENT ON TABLE purchase_document IS '매입 사진(계근표·현장·영수증) — 파일은 비공개 버킷 trade-docs, 권한은 매입을 따라감 (0099)';

CREATE INDEX IF NOT EXISTS idx_purchase_document_purchase ON purchase_document (purchase_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_document_created_by ON purchase_document (created_by) WHERE created_by IS NOT NULL;

-- 올린 시각·올린 사람 — 클라이언트가 보낸 값은 쓰지 않는다(두 표 공용).
CREATE OR REPLACE FUNCTION trade_document_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.created_at := now();
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_document_fill() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_sale_document_fill ON sale_document;
CREATE TRIGGER trg_sale_document_fill
  BEFORE INSERT ON sale_document
  FOR EACH ROW EXECUTE FUNCTION trade_document_fill();

DROP TRIGGER IF EXISTS trg_purchase_document_fill ON purchase_document;
CREATE TRIGGER trg_purchase_document_fill
  BEFORE INSERT ON purchase_document
  FOR EACH ROW EXECUTE FUNCTION trade_document_fill();

-- ---------- RLS: 표 ----------
ALTER TABLE sale_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_document ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sale_document, purchase_document FROM anon;

DROP POLICY IF EXISTS p_sale_document_read   ON sale_document;
DROP POLICY IF EXISTS p_sale_document_insert ON sale_document;
DROP POLICY IF EXISTS p_sale_document_delete ON sale_document;
DROP POLICY IF EXISTS p_purchase_document_read   ON purchase_document;
DROP POLICY IF EXISTS p_purchase_document_insert ON purchase_document;
DROP POLICY IF EXISTS p_purchase_document_delete ON purchase_document;

-- 보기: 그 거래가 보이면(서브쿼리에도 거래 RLS 가 걸린다 = 그 책 viewer 이상).
CREATE POLICY p_sale_document_read ON sale_document FOR SELECT
  USING (EXISTS (SELECT 1 FROM sale s WHERE s.id = sale_document.sale_id));
CREATE POLICY p_purchase_document_read ON purchase_document FOR SELECT
  USING (EXISTS (SELECT 1 FROM purchase p WHERE p.id = purchase_document.purchase_id));

-- 올리기: 지워지지 않은 거래 + 그 책 staff 이상 + 올린 사람은 본인(트리거가 auth.uid() 로 채움).
CREATE POLICY p_sale_document_insert ON sale_document FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM sale s
       WHERE s.id = sale_document.sale_id
         AND s.deleted_at IS NULL
         AND current_user_has_book_role(s.book, 'staff')
    )
  );
CREATE POLICY p_purchase_document_insert ON purchase_document FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM purchase p
       WHERE p.id = purchase_document.purchase_id
         AND p.deleted_at IS NULL
         AND current_user_has_book_role(p.book, 'staff')
    )
  );

-- 빼기: 올린 사람 본인 + 지금도 그 책 staff 이상.
CREATE POLICY p_sale_document_delete ON sale_document FOR DELETE
  USING (
    created_by = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM sale s WHERE s.id = sale_document.sale_id AND current_user_has_book_role(s.book, 'staff'))
  );
CREATE POLICY p_purchase_document_delete ON purchase_document FOR DELETE
  USING (
    created_by = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM purchase p WHERE p.id = purchase_document.purchase_id AND current_user_has_book_role(p.book, 'staff'))
  );

-- ---------- 비공개 버킷 'trade-docs' (5MB, 이미지 3종) — 앱은 올리기 전에 긴 변 2000px JPEG 로 줄인다 ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('trade-docs', 'trade-docs', FALSE, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- 경로의 거래를 올릴 수 있는가 — sale/<uuid>/… 또는 purchase/<uuid>/… 만, 그 거래가 살아 있고 그 책 staff 이상.
-- 버킷 INSERT 정책에서 부른다(표 정책과 같은 기준 — 파일만 올리고 행을 안 넣는 길을 막는다).
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
  END IF;
  RETURN false;
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_document_path_writable(text) FROM anon;

DROP POLICY IF EXISTS p_trade_docs_read   ON storage.objects;
DROP POLICY IF EXISTS p_trade_docs_insert ON storage.objects;
DROP POLICY IF EXISTS p_trade_docs_delete ON storage.objects;

-- 읽기(서명 URL 만들기 포함): 그 경로의 사진 행이 보이면(행 RLS = 거래가 보이면), 또는 내가 올린 파일인데 지금도 그 거래의
-- 책 staff 이상이면. 올린 본인 조건은 빼기 때문: Storage API 는 지우기 전에 SELECT 로 파일을 찾는데, 앱은 행을 먼저
-- 지우므로 행 조인만으론 파일이 안 보여 지워지지 않는다(고아 파일). 본인 조건에 역할 확인을 같이 거는 이유: 책 역할이
-- 빠진 사람이 예전에 올린 B계좌 사진을 anon 키 + 세션으로 계속 열거·서명 URL 받는 길을 막는다(표 정책과 같은 기준).
-- 행이 없는 남의 파일(올리다 만 것)은 여전히 아무도 못 읽는다.
CREATE POLICY p_trade_docs_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trade-docs'
    AND (
      (owner_id = (SELECT auth.uid())::text AND public.trade_document_path_writable(name))
      OR EXISTS (SELECT 1 FROM public.sale_document d WHERE d.path = name)
      OR EXISTS (SELECT 1 FROM public.purchase_document d WHERE d.path = name)
    )
  );
CREATE POLICY p_trade_docs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trade-docs' AND public.trade_document_path_writable(name));
-- 지우기: 올린 본인 + 지금도 그 거래의 책 staff 이상(행을 먼저 지우므로 행 조인은 못 쓴다 — 버킷이 기록한 올린 사람으로).
CREATE POLICY p_trade_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'trade-docs' AND owner_id = (SELECT auth.uid())::text AND public.trade_document_path_writable(name));

-- PostgREST schema cache 강제 reload
NOTIFY pgrst, 'reload schema';
