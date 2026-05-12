-- ============================================================
-- 0025_partner_code_auto.sql
-- partner.code 자동 생성 — 시퀀스 기반 'P-001', 'P-002', ...
-- 폼/시드에서 code를 명시 안 하면 DB가 자동 채움. 사용자가 직접 입력하면 그 값 사용.
-- concurrency safe (시퀀스가 race condition 처리)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS partner_code_seq;

-- 기존 'P-NNN' 패턴 코드들의 최대값으로 시퀀스 초기화
DO $$
DECLARE
  max_num INT;
BEGIN
  SELECT COALESCE(
    MAX((substring(code from '^P-(\d+)$'))::int),
    0
  )
  INTO max_num
  FROM partner
  WHERE code ~ '^P-\d+$';

  IF max_num > 0 THEN
    PERFORM setval('partner_code_seq', max_num);
  END IF;
END $$;

-- DEFAULT 설정: 코드 미명시 INSERT 시 자동 생성
ALTER TABLE partner ALTER COLUMN code
  SET DEFAULT 'P-' || LPAD(nextval('partner_code_seq')::text, 3, '0');

COMMENT ON SEQUENCE partner_code_seq IS 'partner.code 자동 생성용 (P-NNN 형식). 운영 중 수동 코드와 충돌 방지하려면 P- prefix는 자동 생성 전용으로만 쓸 것';
