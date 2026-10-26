-- ============================================================
-- 0084_hometax_invoice.sql
-- 홈택스 계산서 수집본 — 팝빌 "홈택스 전자(세금)계산서 연계"(정액제)로 가져온 매출·매입 (세금)계산서를 쌓는 "국세청 원장".
--   · 기획: docs/홈택스_계산서_수집_연동_기획.md. 매출은 시스템 매출과 대사, 매입은 수집본으로 매입을 채워 넣는다(프리필 → 사람이 저장).
--   · 시스템 거래(sale·purchase·tax_invoice)는 건드리지 않고 이 행에서 **연결(link)** 만 한다 — sale_id / purchase_id / tax_invoice_id + match_status.
--   · 책(book) = 수집한 사업자번호의 책(company_profile.business_no). B계좌(b)는 무자료라 수집 대상이 아니다(절대 룰 2) — CHECK 로 막는다.
--   · 승인번호(nts_confirm_num) UNIQUE — 겹쳐 수집해도, 역발행(발행 API 에도 보임)도 한 건.
--   · 수정세금계산서는 별도 승인번호로 오고 orig_nts_confirm_num 으로 당초 건을 가리킨다. 대사는 그룹 순합계로(기획 §3.2).
--   · raw 에 팝빌 응답 원본(목록 요약 + 상세) 전부 보관 — 필드 매핑이 틀려도 재계산할 수 있게.
--   · INSERT 는 수집 경로(크론 서비스 롤 / [지금 수집] staff)만, 연결·상태 변경은 staff.
-- ============================================================

CREATE TABLE IF NOT EXISTS hometax_invoice (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book                 book_type NOT NULL,
  direction            TEXT NOT NULL,                      -- sell(매출) / buy(매입)
  nts_confirm_num      TEXT NOT NULL,                      -- 국세청 승인번호(24자) — 유일키
  kind                 TEXT NOT NULL DEFAULT 'tax_invoice',-- tax_invoice(세금계산서) / invoice(계산서=면세)
  tax_type             TEXT,                               -- 과세 / 영세 / 면세 (팝빌 원문)
  issue_type           TEXT,                               -- 정발행 / 역발행 / 위수탁 (팝빌 원문)
  purpose              TEXT,                               -- 영수 / 청구 / 없음
  modify_code          SMALLINT,                           -- 수정사유 코드(1~6). NULL/0 = 당초
  orig_nts_confirm_num TEXT,                               -- 수정분이 가리키는 당초 승인번호
  write_date           DATE NOT NULL,                      -- 작성일자
  issue_date           DATE,                               -- 발행일자
  send_date            DATE,                               -- 국세청 전송일자
  supplier             JSONB NOT NULL DEFAULT '{}'::jsonb, -- 공급자 {biz_no,name,ceo,email,tax_reg_id,addr}
  invoicee             JSONB NOT NULL DEFAULT '{}'::jsonb, -- 공급받는자 {biz_no,name,ceo,email,type,tax_reg_id,addr}
  trustee              JSONB,                              -- 수탁자(위수탁일 때)
  supply_amount        NUMERIC(14,0) NOT NULL DEFAULT 0,
  tax_amount           NUMERIC(14,0) NOT NULL DEFAULT 0,
  total_amount         NUMERIC(14,0) NOT NULL DEFAULT 0,
  item_summary         TEXT,                               -- 대표 품목명(목록 요약의 itemName)
  items                JSONB,                              -- 상세 품목 라인(detailList) — 상세 조회 후 채움
  detail_fetched_at    TIMESTAMPTZ,
  raw                  JSONB NOT NULL DEFAULT '{}'::jsonb, -- {abbr: 목록 요약, detail: 상세} 원본
  source               TEXT NOT NULL DEFAULT 'popbill',    -- popbill / excel(보조 입구)
  collected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 대사·연결 (기획 §3·§4) — 거래 테이블은 건드리지 않고 여기서만 가리킨다
  match_status         TEXT NOT NULL DEFAULT 'unmatched',  -- unmatched / candidate / matched / linked / mismatch / ignored
  sale_id              UUID REFERENCES sale(id),
  purchase_id          UUID REFERENCES purchase(id),
  tax_invoice_id       UUID REFERENCES tax_invoice(id),
  matched_at           TIMESTAMPTZ,
  matched_by           UUID REFERENCES user_profile(user_id),
  ignore_reason        TEXT,                               -- match_status='ignored' 일 때 필수(앱에서 강제)
  notes                TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ,

  CONSTRAINT chk_hti_direction    CHECK (direction IN ('sell','buy')),
  CONSTRAINT chk_hti_kind         CHECK (kind IN ('tax_invoice','invoice')),
  CONSTRAINT chk_hti_source       CHECK (source IN ('popbill','excel')),
  CONSTRAINT chk_hti_match_status CHECK (match_status IN ('unmatched','candidate','matched','linked','mismatch','ignored')),
  CONSTRAINT chk_hti_no_b_book    CHECK (book <> 'b'),     -- 절대 룰 2: B계좌는 계산서가 없다
  CONSTRAINT chk_hti_nts_len      CHECK (length(nts_confirm_num) = 24)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hometax_invoice_nts ON hometax_invoice(nts_confirm_num);
CREATE INDEX IF NOT EXISTS idx_hometax_invoice_book_dir_date ON hometax_invoice(book, direction, write_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hometax_invoice_supplier_biz ON hometax_invoice((supplier->>'biz_no')) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hometax_invoice_invoicee_biz ON hometax_invoice((invoicee->>'biz_no')) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hometax_invoice_status ON hometax_invoice(book, match_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hometax_invoice_orig ON hometax_invoice(orig_nts_confirm_num) WHERE orig_nts_confirm_num IS NOT NULL;

DROP TRIGGER IF EXISTS trg_hometax_invoice_updated_at ON hometax_invoice;
CREATE TRIGGER trg_hometax_invoice_updated_at
  BEFORE UPDATE ON hometax_invoice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE hometax_invoice IS '홈택스 (세금)계산서 수집본(팝빌 홈택스 연계). 승인번호 UNIQUE. 거래와는 sale_id/purchase_id/tax_invoice_id 로 연결만 (0084)';

-- ------------------------------------------------------------
-- 수집 작업 이력 — 팝빌 requestJob 단위. [지금 수집]·크론 모두 여기 남긴다.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hometax_collection_job (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book          book_type NOT NULL,
  direction     TEXT NOT NULL,                              -- sell / buy
  job_id        TEXT,                                       -- 팝빌 작업아이디(18자)
  date_type     TEXT NOT NULL DEFAULT 'S',                  -- W 작성일 / I 발행일 / S 전송일
  from_date     DATE NOT NULL,
  to_date       DATE NOT NULL,
  state         TEXT NOT NULL DEFAULT 'requested',          -- requested / running / done / failed
  found         INT,                                        -- 팝빌이 돌려준 건수
  inserted      INT,                                        -- 새로 저장한 건수
  updated       INT,                                        -- 이미 있어 갱신만 한 건수
  error         TEXT,
  source        TEXT NOT NULL DEFAULT 'manual',             -- cron / manual
  requested_by  UUID REFERENCES user_profile(user_id),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,

  CONSTRAINT chk_htj_direction CHECK (direction IN ('sell','buy')),
  CONSTRAINT chk_htj_date_type CHECK (date_type IN ('W','I','S')),
  CONSTRAINT chk_htj_state     CHECK (state IN ('requested','running','done','failed')),
  CONSTRAINT chk_htj_source    CHECK (source IN ('cron','manual')),
  CONSTRAINT chk_htj_no_b_book CHECK (book <> 'b')
);
CREATE INDEX IF NOT EXISTS idx_hometax_job_book_time ON hometax_collection_job(book, requested_at DESC);

-- ------------------------------------------------------------
-- RLS — 책 기준. SELECT viewer / INSERT·UPDATE staff. 크론(서비스 롤)은 RLS 우회. 삭제는 soft(deleted_at).
-- ------------------------------------------------------------
ALTER TABLE hometax_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE hometax_collection_job ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hometax_invoice_select ON hometax_invoice;
DROP POLICY IF EXISTS hometax_invoice_insert ON hometax_invoice;
DROP POLICY IF EXISTS hometax_invoice_update ON hometax_invoice;
CREATE POLICY hometax_invoice_select ON hometax_invoice FOR SELECT USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY hometax_invoice_insert ON hometax_invoice FOR INSERT WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY hometax_invoice_update ON hometax_invoice FOR UPDATE USING (current_user_has_book_role(book, 'staff')) WITH CHECK (current_user_has_book_role(book, 'staff'));

DROP POLICY IF EXISTS hometax_job_select ON hometax_collection_job;
DROP POLICY IF EXISTS hometax_job_insert ON hometax_collection_job;
DROP POLICY IF EXISTS hometax_job_update ON hometax_collection_job;
CREATE POLICY hometax_job_select ON hometax_collection_job FOR SELECT USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY hometax_job_insert ON hometax_collection_job FOR INSERT WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY hometax_job_update ON hometax_collection_job FOR UPDATE USING (current_user_has_book_role(book, 'staff')) WITH CHECK (current_user_has_book_role(book, 'staff'));

-- 우리 발행 기록의 출처에 'hometax'(수기 승격·홈택스에만 있는 매출 생성) 를 허용 — 제약은 없고 값 규칙만 문서화.
COMMENT ON COLUMN tax_invoice.provider IS 'ASP 식별 — popbill(팝빌 발행) / manual(수기 기록) / hometax(홈택스 수집본으로 승격·생성, 0084)';

NOTIFY pgrst, 'reload schema';
