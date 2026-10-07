-- ============================================================
-- 0069_radar_v2.sql
-- 발주 레이더 v2 — 처분(제외)·단계 반영 시각·낙찰사 사업자번호·영업내역 연결 + 기록 RPC.
-- 기획안: docs/발주_레이더_v2_기획.md §8 (신규 테이블 0 · 컬럼 6 · 인덱스 4 · RPC 1 · 트리거 0 · RLS 변경 0)
--
-- 설계 원칙
--  - 상태(오늘/대기/완료)는 저장하지 않는다. sales_log(기록·다음 행동일)와 dismissed_at(제외)에서 파생.
--  - 수집기는 사람 컬럼(dismissed_at·dismiss_reason·linked_partner_id)을 절대 덮지 않는다(index.ts 화이트리스트).
--  - stage_changed_at = 단계(허가/착공/낙찰…)가 DB에 반영된 시각. 방문 탭 창(60일)·'오늘' 판정 기준.
--    수집기가 upsert 전 사전조회로 채우므로 트리거 없음. 1회 백필은 GREATEST(created_at, stage_date) 근사.
--  - 물리 삭제 없음. notice(시청 고시) 72행만 soft delete. 권역 오판 행은 scripts/radar-v2-cleanup.ts.
-- ============================================================

-- 1) construction_project — 처분·단계 반영 시각·낙찰사 사업자번호(생성 컬럼)
ALTER TABLE construction_project
  ADD COLUMN IF NOT EXISTS dismissed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismiss_reason   TEXT,
  ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS awardee_bizno    TEXT GENERATED ALWAYS AS (
    NULLIF(regexp_replace(COALESCE(raw->>'bidwinnrBizno', ''), '[^0-9]', '', 'g'), '')
  ) STORED;

COMMENT ON COLUMN construction_project.dismissed_at     IS '제외(처분) 시각. 있으면 완료 탭. 수집기는 덮지 않음';
COMMENT ON COLUMN construction_project.dismiss_reason   IS '제외 사유 3종: 철근 안 씀·거절(영구) / 현장 없음·연락 불가·폐업 / 기타';
COMMENT ON COLUMN construction_project.stage_changed_at IS '단계가 DB에 반영된 시각(수집기 사전조회로 갱신). 방문 창·오늘 판정 기준';
COMMENT ON COLUMN construction_project.awardee_bizno    IS '낙찰사 사업자번호(raw.bidwinnrBizno 숫자만, 생성 컬럼). partner.business_no 조인·계정 단위 처분';

ALTER TABLE construction_project DROP CONSTRAINT IF EXISTS construction_project_dismiss_reason_check;
ALTER TABLE construction_project ADD CONSTRAINT construction_project_dismiss_reason_check
  CHECK (dismiss_reason IS NULL OR dismiss_reason IN ('철근 안 씀·거절', '현장 없음·연락 불가·폐업', '기타'));

-- 1회 백필(근사): 허가로 들어와 착공으로 바뀐 행은 착공일이 하한. 2회 동기화 뒤부터 정확.
UPDATE construction_project
   SET stage_changed_at = GREATEST(created_at, stage_date::timestamptz)
 WHERE stage_changed_at IS NULL;

-- 2) sales_log — 레이더 행 연결 + 현장·통화에서 확보한 번호(0016에 phone 컬럼 없음)
ALTER TABLE sales_log
  ADD COLUMN IF NOT EXISTS project_id    UUID REFERENCES construction_project(id),
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

COMMENT ON COLUMN sales_log.project_id    IS '발주 레이더 행(construction_project) — 레이더 [기록]으로 생긴 영업내역';
COMMENT ON COLUMN sales_log.contact_phone IS '현장·통화에서 확보한 담당자 전화';

-- 3) 인덱스 — 화면 쿼리 형태에 맞춘 부분 인덱스(활성·미처분 행만)
CREATE INDEX IF NOT EXISTS idx_cproj_v2_visit
  ON construction_project (region, stage, stage_changed_at DESC)
  WHERE deleted_at IS NULL AND dismissed_at IS NULL AND source = 'building_permit';
CREATE INDEX IF NOT EXISTS idx_cproj_v2_phone
  ON construction_project (stage_date DESC)
  WHERE deleted_at IS NULL AND dismissed_at IS NULL AND stage = 'awarded';
CREATE INDEX IF NOT EXISTS idx_cproj_awardee_bizno
  ON construction_project (awardee_bizno)
  WHERE awardee_bizno IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_log_project
  ON sales_log (project_id)
  WHERE project_id IS NOT NULL AND deleted_at IS NULL;

-- 4) RPC radar_touch — [기록] 한 번 = sales_log INSERT + (거절·현장없음이면) 제외 UPDATE 를 한 트랜잭션으로.
--    SECURITY INVOKER → 호출자 RLS 그대로(construction_project 0038: owner/manager · sales_log 0019: p_master_write_check).
--    결과 코드 4종 고정(자유 텍스트 금지) — 2주 가설 판정의 입력. 제외는 낙찰사(awardee_bizno)가 있으면 계정 전체.
CREATE OR REPLACE FUNCTION radar_touch(
  p_project_id     uuid,
  p_channel        text,              -- 'phone' | 'visit'
  p_result         text,              -- 견적 요청 | 다음에 | 철근 안 씀·거절 | 현장 없음·연락 불가·폐업
  p_contact_person text DEFAULT NULL,
  p_contact_phone  text DEFAULT NULL,
  p_company        text DEFAULT NULL, -- 현장에서 확보한 시공사·업체명(민간)
  p_notes          text DEFAULT NULL,
  p_follow_up_on   date DEFAULT NULL,
  p_contacted_on   date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_proj     construction_project%ROWTYPE;
  v_log_id   uuid;
  v_dismiss  text;
  v_prospect text;
BEGIN
  IF p_channel NOT IN ('phone', 'visit') THEN
    RAISE EXCEPTION 'radar_touch: channel must be phone|visit (got %)', p_channel;
  END IF;
  IF p_result NOT IN ('견적 요청', '다음에', '철근 안 씀·거절', '현장 없음·연락 불가·폐업') THEN
    RAISE EXCEPTION 'radar_touch: invalid result code %', p_result;
  END IF;

  SELECT * INTO v_proj
    FROM construction_project
   WHERE id = p_project_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'radar_touch: project % not found', p_project_id;
  END IF;

  v_dismiss  := CASE WHEN p_result IN ('철근 안 씀·거절', '현장 없음·연락 불가·폐업') THEN p_result END;
  v_prospect := COALESCE(v_proj.awarded_company, NULLIF(btrim(p_company), ''), v_proj.address, v_proj.title);

  INSERT INTO sales_log (
    contacted_on, partner_id, prospect_name, contact_person, channel, result, follow_up_on, notes,
    created_by, project_id, contact_phone
  ) VALUES (
    COALESCE(p_contacted_on, CURRENT_DATE),
    v_proj.linked_partner_id,
    v_prospect,
    NULLIF(btrim(p_contact_person), ''),
    p_channel,
    p_result,
    CASE WHEN v_dismiss IS NULL THEN p_follow_up_on END,
    NULLIF(btrim(p_notes), ''),
    auth.uid(),
    p_project_id,
    NULLIF(btrim(p_contact_phone), '')
  )
  RETURNING id INTO v_log_id;

  IF v_dismiss IS NOT NULL THEN
    IF v_proj.awardee_bizno IS NOT NULL THEN
      -- 전화 탭: 계정(낙찰사) 전체 — 새 낙찰 행이 와도 숨김(수신거부·폐업 보장)
      UPDATE construction_project
         SET dismissed_at = now(), dismiss_reason = v_dismiss
       WHERE awardee_bizno = v_proj.awardee_bizno
         AND deleted_at IS NULL AND dismissed_at IS NULL;
    ELSE
      UPDATE construction_project
         SET dismissed_at = now(), dismiss_reason = v_dismiss
       WHERE id = p_project_id;
    END IF;
  END IF;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) TO authenticated;

-- 5) 시청 고시 72행 soft delete — 2026-06-02 이후 미수집, 연락 주체 없음(기획안 §10). 복구 가능.
UPDATE construction_project
   SET deleted_at = now()
 WHERE source = 'notice' AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
