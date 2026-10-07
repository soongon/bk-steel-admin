-- ============================================================
-- 0072_radar_v2_refusal_scope.sql
-- 발주 레이더 v2 — 최종 검증 반영(0069~0071 원격 적용됨 → 보강만).
--
--  1) radar_is_refusal v2 — TS normalizeResultCode 와 같은 규칙: 거절·거부·연락 말라 = 수신거부,
--     단 부정·번복('거절 안 함'·'미거절'·'거절했다가 다시 요청')은 제외.
--  2) radar_touch v4
--     - 수신거부 사전검사에 메모 "레이더 {id}"만 있는 미연결 수기 기록도 포함(연결 cron 대기 없이 즉시).
--     - 계정 단위 제외 범위를 soft delete 행까지 — [제외]·기록 연결·숨김 판정과 같은 범위(복구도 같은 범위).
-- ============================================================

CREATE OR REPLACE FUNCTION radar_is_refusal(p_result text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH t AS (SELECT regexp_replace(COALESCE(p_result, ''), '[[:space:]·ㆍ.・]', '', 'g') AS s)
  SELECT s ~ '(철근안씀|거절|거부|연락(하지)?마|연락말)'
     AND s !~ '((거절|거부)(안|아님|없|x|X)|미거절|했다가)'
    FROM t;
$$;

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
  v_rows      integer;
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

  -- 수신거부 보장: 이 행·계정(사업자번호)에 '거절' 제외, 또는 '거절' 기록(연결된 기록 + 메모 "레이더 {id}" 미연결 기록)이 있으면 거부.
  IF v_proj.dismiss_reason = '철근 안 씀·거절'
     OR (v_proj.awardee_bizno IS NOT NULL AND EXISTS (
           SELECT 1 FROM construction_project
            WHERE awardee_bizno = v_proj.awardee_bizno
              AND dismiss_reason = '철근 안 씀·거절'))
     OR EXISTS (
           SELECT 1
             FROM construction_project cp
             JOIN sales_log sl
               ON sl.deleted_at IS NULL
              AND radar_is_refusal(sl.result)
              AND (sl.project_id = cp.id
                   OR (sl.project_id IS NULL AND sl.notes ILIKE '%' || cp.id::text || '%'))
            WHERE cp.id = v_proj.id
               OR (v_proj.awardee_bizno IS NOT NULL AND cp.awardee_bizno = v_proj.awardee_bizno)) THEN
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
    -- 계정 단위는 soft delete 행까지(숨김·복구와 같은 범위). '거절'은 복구 가능 사유를 영구로 승격.
    UPDATE construction_project
       SET dismissed_at = now(), dismiss_reason = v_dismiss
     WHERE (CASE WHEN v_proj.awardee_bizno IS NOT NULL
                 THEN awardee_bizno = v_proj.awardee_bizno
                 ELSE id = p_project_id END)
       AND (dismissed_at IS NULL
            OR (v_dismiss = '철근 안 씀·거절' AND dismiss_reason IS DISTINCT FROM '철근 안 씀·거절'));
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'radar_touch: already dismissed project %', p_project_id;
    END IF;
  END IF;

  RETURN v_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
