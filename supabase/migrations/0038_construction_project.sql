-- ============================================================
-- 0038_construction_project.sql
-- 발주 레이더 — 경주·포항·울산 건설 발주 인텔리전스 (외부 공공데이터).
--
-- 운영(매출·매입·통장)과 완전 분리된 독립 테이블. book 컬럼 없음.
-- 100% 정상 외부데이터 → 법인 영역. B계좌/무자료와 절대 무관.
-- 수집기는 service_role 로 upsert(RLS 우회). 화면은 인증 사용자 read.
--
-- 컨벤션: 0031_site.sql 패턴 (단수 테이블명·set_updated_at·soft delete·NOTIFY pgrst).
-- ※ 핸드오프 §4는 'construction_projects'(복수)였으나, repo 전체가 단수 테이블명
--   (site/partner/sale…)이라 'construction_project'로 통일. 컬럼 linked_customer_id →
--   repo엔 customers 없음 → partner(id) 참조하는 linked_partner_id 로.
-- 참조: 핸드오프 §4 스키마 / §5 단계 / §6 점수
-- ============================================================

CREATE TABLE IF NOT EXISTS construction_project (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 소스·중복방지
  source            TEXT NOT NULL CHECK (source IN ('building_permit', 'nara_bid')),
  source_key        TEXT NOT NULL,                 -- 허가대장PK or 공고번호

  -- 지역
  region            TEXT NOT NULL CHECK (region IN ('gyeongju', 'pohang', 'ulsan')),
  sigungu_code      TEXT,                          -- 시군구코드 5자리
  project_type      TEXT NOT NULL CHECK (project_type IN ('private', 'public')),

  -- 현장 식별
  title             TEXT NOT NULL,                 -- 현장명/공고명
  address           TEXT,
  lat               DOUBLE PRECISION,              -- 지오코딩 결과 (phase 1.5)
  lng               DOUBLE PRECISION,
  distance_km       DOUBLE PRECISION,              -- 차고지 기준 거리 (지오코딩 단계 계산)

  -- 분류·물량
  usage             TEXT,                          -- 용도 (공장/창고/근린/공동주택/교육…)
  structure         TEXT CHECK (structure IN ('RC', 'steel', 'etc')),
  floor_area        DOUBLE PRECISION,              -- 연면적 ㎡
  est_rebar_ton     DOUBLE PRECISION,              -- 추정 철근/강관 톤 (계수 계산)

  -- 단계(상태 머신) — 핸드오프 §5
  stage             TEXT NOT NULL CHECK (stage IN (
                      'permit', 'construction_start', 'completed', 'bid_notice', 'awarded')),
  stage_date        DATE,                          -- 허가일/착공일/공고일/낙찰일

  -- 연락 주체
  ordering_org      TEXT,                          -- 발주처 (관급, 시청 등 — 표시용·연락대상 아님)
  contact_party     TEXT,                          -- 연락 주체 (민간: 건축주/시공사, 관급: 낙찰사)
  awarded_company   TEXT,                          -- 낙찰사명 (관급, 낙찰 후)

  -- 점수
  relevance_grade   TEXT CHECK (relevance_grade IN ('A', 'B', 'C')),
  relevance_score   NUMERIC,                       -- 점수 원본 (정렬·디버깅)
  est_amount        BIGINT,                        -- 추정가격/기초금액 (관급)

  -- 2차(리드 전환)용 — 지금은 항상 null
  linked_partner_id UUID REFERENCES partner(id),

  -- 원시·메타
  raw               JSONB,                         -- 원시 응답 (디버깅·재처리)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- = 최초 수집(first seen)
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- = 최종 갱신
  deleted_at        TIMESTAMPTZ,

  -- 중복 방지: (source, source_key) — upsert ON CONFLICT 대상 (soft-delete 행도 포함하도록 비부분)
  CONSTRAINT uq_construction_project_source UNIQUE (source, source_key)
);

-- 조회 인덱스 (핸드오프 §4)
CREATE INDEX IF NOT EXISTS idx_cproj_region_grade
  ON construction_project (region, relevance_grade) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cproj_stage_date
  ON construction_project (stage, stage_date) WHERE deleted_at IS NULL;

-- updated_at 자동 갱신 (site 동일 패턴)
DROP TRIGGER IF EXISTS trg_construction_project_updated_at ON construction_project;
CREATE TRIGGER trg_construction_project_updated_at
  BEFORE UPDATE ON construction_project FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- audit 트리거는 의도적으로 미부착: 매일 기계 ingest(대량 upsert)라 audit_log 오염.
-- 외부 정상데이터라 감사 대상도 아님.

-- ============================================================
-- RLS — site(0031) 패턴: 인증 사용자 SELECT / owner·manager 변경.
-- (수집기는 service_role 키로 RLS 우회 upsert. 이 정책은 UI 수동편집용.)
-- ============================================================
ALTER TABLE construction_project ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_cproj_read   ON construction_project;
DROP POLICY IF EXISTS p_cproj_insert ON construction_project;
DROP POLICY IF EXISTS p_cproj_update ON construction_project;
DROP POLICY IF EXISTS p_cproj_delete ON construction_project;

CREATE POLICY p_cproj_read ON construction_project FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY p_cproj_insert ON construction_project FOR INSERT
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_cproj_update ON construction_project FOR UPDATE
  USING (current_user_is_owner_or_manager_any_book())
  WITH CHECK (current_user_is_owner_or_manager_any_book());

CREATE POLICY p_cproj_delete ON construction_project FOR DELETE
  USING (current_user_is_owner_or_manager_any_book());

NOTIFY pgrst, 'reload schema';
