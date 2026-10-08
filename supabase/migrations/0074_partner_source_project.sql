-- ============================================================
-- 0074_partner_source_project.sql
-- 발주 레이더 v2 2주차 후속 — 레이더에서 새로 만든 거래처의 출처.
--
--  partner.source_project_id: [거래처로]로 "새로 만든" 거래처의 레이더 행. 용도:
--   1) 견적서 문자(MMS) 가드 — 레이더에서 만든 거래처(매출 이력 없음)는 견적 메뉴에서 만든 견적이라도 그 출처 행·계정,
--      ★ 연결 행, 또는 그 거래처를 골라 남긴 영업내역에 '견적 요청' 기록이 있어야 발송(수신자 요청 원칙, 정보통신망법 §50 취지 — 법률 자문 아님).
--  ⚠ 이 FK 로 construction_project ↔ partner 관계가 둘이 된다 — 둘 사이 embed 는 관계 이름을 명시할 것(힌트 없으면 PGRST201).
--   2) 판정 지표 — 레이더에서 만든 거래처의 매출(평소 매출 폼 경로)도 레이더 유래로 집계
--  기존 거래처에 "연결만" 한 경우·거래처 메뉴·명함 등록은 NULL. 출처가 NULL 인 ★ 거래처는 앱이 등록 시각으로 가른다
--  (캠페인 시작 2026-10-07 전에, 그리고 ★ 행이 처음 수집되기 전에 등록된 곳만 '레이더 이전부터' → 거절 기록만 막음,
--   그 밖은 '견적 요청' 필요 — lib/radar/v2-rules.ts preRadarPartner).
--  적용 시점 출처를 채울 거래처 없음(2026-10-08 확인) → 백필 없음.
-- ============================================================

ALTER TABLE partner
  ADD COLUMN IF NOT EXISTS source_project_id UUID REFERENCES construction_project(id);
COMMENT ON COLUMN partner.source_project_id IS '발주 레이더 [거래처로]로 새로 만든 거래처의 출처 행(construction_project). 문자 가드·레이더 유래 매출 집계용';

CREATE INDEX IF NOT EXISTS idx_partner_source_project
  ON partner (source_project_id)
  WHERE source_project_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
