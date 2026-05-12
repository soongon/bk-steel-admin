-- ============================================================
-- 0026_partner_code_seq_sync.sql
-- partner.code 'P-NNN' 형식 명시 INSERT가 sequence를 advance 하지 않는 문제 해결.
--
-- 시나리오:
--   1) 0025에서 partner_code_seq 시퀀스 + DEFAULT 설정. 빈 DB 시점이라 seq=1.
--   2) 시드 스크립트가 master partner 9건을 P-001 ~ P-009 explicit code로 insert.
--      → 시퀀스는 advance 안 됨 (DEFAULT가 호출되지 않았으므로). 여전히 last_value=1.
--   3) 후속 auto-create (code 미명시 insert)가 nextval(seq)=1 → 'P-001' 생성 시도 → UNIQUE 충돌.
--
-- 해결:
--   - BEFORE INSERT trigger로 NEW.code가 'P-NNN' 패턴이면 시퀀스를 그 값 이상으로 자동 bump.
--   - 본 마이그레이션 시점에 1회 setval(seq, max('P-NNN')) 로 캐치업.
-- ============================================================

CREATE OR REPLACE FUNCTION sync_partner_code_seq()
RETURNS TRIGGER AS $$
DECLARE
  matched_num INT;
  current_max BIGINT;
BEGIN
  IF NEW.code ~ '^P-\d+$' THEN
    matched_num := (substring(NEW.code from '^P-(\d+)$'))::int;
    SELECT last_value INTO current_max FROM partner_code_seq;
    IF matched_num > current_max THEN
      PERFORM setval('partner_code_seq', matched_num);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION sync_partner_code_seq() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sync_partner_code_seq() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_partner_sync_code_seq ON partner;
CREATE TRIGGER trg_partner_sync_code_seq
  BEFORE INSERT ON partner
  FOR EACH ROW EXECUTE FUNCTION sync_partner_code_seq();

-- 1회 캐치업: 기존 'P-NNN' 코드의 최대값으로 시퀀스 bump
DO $$
DECLARE
  max_num INT;
BEGIN
  SELECT COALESCE(MAX((substring(code from '^P-(\d+)$'))::int), 0)
    INTO max_num
    FROM partner
    WHERE code ~ '^P-\d+$';

  IF max_num > 0 THEN
    PERFORM setval('partner_code_seq', max_num);
  END IF;
END $$;
