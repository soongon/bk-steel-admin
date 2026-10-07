-- ============================================================
-- 0071_radar_v2_refusal_trigger.sql
-- 발주 레이더 v2 — 재검증 반영(0069·0070 은 원격 적용됨 → 보강만).
--
--  1) 단계 반영 시각 트리거 — 어떤 수집기든(main 의 구 수집기 포함) stage 가 바뀌면 stage_changed_at = now().
--     0070 의 DEFAULT now() 는 INSERT 에만 붙어, 구 수집기의 ON CONFLICT 갱신(허가→착공)은 stage_changed_at 을
--     옛 값으로 두었다 → 방문 창(60일)에서 영구 누락. v2 수집기는 단계가 바뀌면 직접 now 를 넣으므로 그대로 둔다.
--  2) radar_is_refusal(text) — 결과 문구 정규화(공백·가운뎃점 제거 후 '철근안씀|거절'). TS normalizeResultCode 와 같은 규칙.
--  3) radar_touch v3 — 수신거부 판정에 영업내역의 '거절' 기록(수기 포함)도 넣고, soft delete 와 무관하게 본다.
--     '철근 안 씀·거절'은 복구 가능 사유로 이미 제외된 행도 영구로 승격. 제외할 행이 하나도 없으면 오류(거짓 성공 방지).
-- ============================================================

-- 1) stage_changed_at 트리거 ─────────────────────────────────
CREATE OR REPLACE FUNCTION construction_project_stage_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage
     AND NEW.stage_changed_at IS NOT DISTINCT FROM OLD.stage_changed_at THEN
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cproj_stage_changed ON construction_project;
CREATE TRIGGER trg_cproj_stage_changed
  BEFORE UPDATE OF stage ON construction_project
  FOR EACH ROW EXECUTE FUNCTION construction_project_stage_changed();

-- 2) 결과 문구 → 거절 여부 ─────────────────────────────────
CREATE OR REPLACE FUNCTION radar_is_refusal(p_result text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(COALESCE(p_result, ''), '[[:space:]·ㆍ.・]', '', 'g') ~ '(철근안씀|거절)';
$$;

-- 3) radar_touch v3 ──────────────────────────────────────────
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

  -- 수신거부 보장: 이 행·계정(사업자번호)에 '거절' 제외 또는 '거절' 기록(수기 포함)이 있으면 새 기록을 받지 않는다.
  -- soft delete 와 무관(거절은 행이 아니라 계정의 속성).
  IF v_proj.dismiss_reason = '철근 안 씀·거절'
     OR (v_proj.awardee_bizno IS NOT NULL AND EXISTS (
           SELECT 1 FROM construction_project
            WHERE awardee_bizno = v_proj.awardee_bizno
              AND dismiss_reason = '철근 안 씀·거절'))
     OR EXISTS (
           SELECT 1
             FROM sales_log sl
             JOIN construction_project cp ON cp.id = sl.project_id
            WHERE sl.deleted_at IS NULL
              AND radar_is_refusal(sl.result)
              AND (cp.id = v_proj.id
                   OR (v_proj.awardee_bizno IS NOT NULL AND cp.awardee_bizno = v_proj.awardee_bizno))) THEN
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
    -- 미제외 행 + ('거절'이면) 복구 가능 사유로 이미 제외된 행도 영구로 승격. 이미 같은/더 강한 사유면 건드리지 않음.
    UPDATE construction_project
       SET dismissed_at = now(), dismiss_reason = v_dismiss
     WHERE (CASE WHEN v_proj.awardee_bizno IS NOT NULL
                 THEN awardee_bizno = v_proj.awardee_bizno AND deleted_at IS NULL
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

-- CREATE OR REPLACE 는 기존 권한을 유지하지만, 명시적으로 다시 고정한다(0070 과 동일).
REVOKE EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION radar_touch(uuid, text, text, text, text, text, text, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
