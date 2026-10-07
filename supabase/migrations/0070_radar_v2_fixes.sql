-- ============================================================
-- 0070_radar_v2_fixes.sql
-- 발주 레이더 v2 — 1주차 코드 리뷰 반영(0069는 원격 적용됨 → 수정하지 않고 보강).
--
--  1) last_seen_at — 수집기만 쓰는 '마지막 수집 시각'. 헤더 '동기화'를 max(updated_at)로 근사하던 방식은
--     [제외]·정리 스크립트·마이그레이션 UPDATE 에도 흔들렸다(updated_at 트리거는 모든 UPDATE에 발화).
--  2) stage_changed_at DEFAULT now() — main 의 구 수집기(이 컬럼을 모름)가 넣는 새 행도 방문 창에 들어오게.
--  3) radar_touch 재정의 — 영구 제외('철근 안 씀·거절') 서버 강제, 단건 제외 분기에도 dismissed_at IS NULL 가드,
--     다음 행동일 기본값(+7일; 기한 없는 '대기' 영구 체류 방지).
--  4) radar_touch 실행 권한 — PUBLIC·anon 회수(Supabase 기본 권한상 GRANT TO authenticated 만으로는 anon 도 호출 가능).
-- ============================================================

-- 1) last_seen_at ────────────────────────────────────────────
ALTER TABLE construction_project ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
COMMENT ON COLUMN construction_project.last_seen_at IS
  '수집기가 마지막으로 이 행을 소스에서 받은 시각(collectors/index.ts 가 매 upsert 기록). 사람·스크립트는 쓰지 않음. 헤더 동기화 = 소스별 max';

-- 1회 백필(근사, 행별 값이 아니라 소스별 max 를 맞추는 목적):
--  0069 의 stage_changed_at 백필 UPDATE 가 모든 행의 updated_at 을 2026-10-06 15시(KST)로 올렸으므로 그 이전 값은 잃었다.
--  0069 직전 측정치(세션 감사 radar-stats-out.txt): 건축 max(updated_at)=2026-10-04 00:48:12Z, 나라장터=2026-10-06 01:49:52Z.
--  그 뒤 수집기가 다시 갱신한 행(2026-10-07 나라장터 cron, 구 코드)은 updated_at 그대로.
UPDATE construction_project
   SET last_seen_at = CASE
         WHEN updated_at > TIMESTAMPTZ '2026-10-06 12:00:00+00' AND source = 'nara_bid' THEN updated_at
         WHEN source = 'nara_bid' THEN LEAST(updated_at, TIMESTAMPTZ '2026-10-06 01:49:52+00')
         ELSE LEAST(updated_at, TIMESTAMPTZ '2026-10-04 00:48:12+00')
       END
 WHERE last_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cproj_last_seen
  ON construction_project (source, last_seen_at DESC)
  WHERE deleted_at IS NULL;

-- 2) stage_changed_at 기본값 + 누락 백필 ─────────────────────
ALTER TABLE construction_project ALTER COLUMN stage_changed_at SET DEFAULT now();
UPDATE construction_project
   SET stage_changed_at = GREATEST(created_at, stage_date::timestamptz)
 WHERE stage_changed_at IS NULL;

-- 3) radar_touch 재정의 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION radar_touch(
  p_project_id     uuid,
  p_channel        text,              -- 'phone' | 'visit'
  p_result         text,              -- 견적 요청 | 다음에 | 철근 안 씀·거절 | 현장 없음·연락 불가·폐업
  p_contact_person text DEFAULT NULL,
  p_contact_phone  text DEFAULT NULL, -- 숫자만(호출부가 정규화)
  p_company        text DEFAULT NULL, -- 현장에서 확보한 시공사·업체명(민간)
  p_notes          text DEFAULT NULL,
  p_follow_up_on   date DEFAULT NULL, -- 비우면 접촉일 + 7일
  p_contacted_on   date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_proj      construction_project%ROWTYPE;
  v_log_id    uuid;
  v_dismiss   text;
  v_prospect  text;
  v_contacted date := COALESCE(p_contacted_on, CURRENT_DATE);
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

  -- 수신거부 보장: '철근 안 씀·거절'로 제외된 행(전화 탭은 같은 사업자번호 계정 전체)에는 새 기록을 받지 않는다.
  IF v_proj.dismiss_reason = '철근 안 씀·거절'
     OR (v_proj.awardee_bizno IS NOT NULL AND EXISTS (
           SELECT 1 FROM construction_project
            WHERE awardee_bizno = v_proj.awardee_bizno
              AND dismiss_reason = '철근 안 씀·거절'
              AND deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'radar_touch: permanently dismissed project %', p_project_id;
  END IF;

  v_dismiss  := CASE WHEN p_result IN ('철근 안 씀·거절', '현장 없음·연락 불가·폐업') THEN p_result END;
  v_prospect := COALESCE(v_proj.awarded_company, NULLIF(btrim(p_company), ''), v_proj.address, v_proj.title);

  INSERT INTO sales_log (
    contacted_on, partner_id, prospect_name, contact_person, channel, result, follow_up_on, notes,
    created_by, project_id, contact_phone
  ) VALUES (
    v_contacted,
    v_proj.linked_partner_id,
    v_prospect,
    NULLIF(btrim(p_contact_person), ''),
    p_channel,
    p_result,
    CASE WHEN v_dismiss IS NULL THEN COALESCE(p_follow_up_on, v_contacted + 7) END,
    NULLIF(btrim(p_notes), ''),
    auth.uid(),
    p_project_id,
    NULLIF(regexp_replace(COALESCE(p_contact_phone, ''), '[^0-9]', '', 'g'), '')
  )
  RETURNING id INTO v_log_id;

  IF v_dismiss IS NOT NULL THEN
    IF v_proj.awardee_bizno IS NOT NULL THEN
      -- 전화 탭: 계정(낙찰사) 전체 — 새 낙찰 행이 와도 숨김
      UPDATE construction_project
         SET dismissed_at = now(), dismiss_reason = v_dismiss
       WHERE awardee_bizno = v_proj.awardee_bizno
         AND deleted_at IS NULL AND dismissed_at IS NULL;
    ELSE
      UPDATE construction_project
         SET dismissed_at = now(), dismiss_reason = v_dismiss
       WHERE id = p_project_id
         AND dismissed_at IS NULL;   -- 이미 제외된 행의 사유·시각을 덮지 않는다(영구 제외 강등 방지)
    END IF;
  END IF;

  RETURN v_log_id;
END;
$$;

-- 4) 실행 권한 — 인증 사용자만 ────────────────────────────────
REVOKE EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
