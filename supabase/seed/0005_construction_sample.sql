-- ============================================================
-- 0005_construction_sample.sql
-- 발주 레이더 UI 시연용 샘플 — construction_project.
--
-- 실수집(npm run radar:collect) 전, 대시보드 레이아웃·연락주체 강조·정렬을 눈으로
-- 확인하기 위한 더미 데이터. relevance_*/est_rebar_ton 은 lib/radar/scoring.ts 와
-- 정합한 대략치로 하드코딩(시드라 TS 점수엔진을 못 부름). 운영엔 불필요 — 적용 선택.
--
-- 안전: ON CONFLICT (source, source_key) DO NOTHING — 재실행해도 중복 없음.
--   되돌리기: DELETE FROM construction_project WHERE source_key LIKE '%-SAMPLE-%';
-- 선행: 0038_construction_project.sql
-- ============================================================

INSERT INTO construction_project
  (source, source_key, region, sigungu_code, project_type, title, address,
   usage, structure, floor_area, est_rebar_ton, stage, stage_date,
   ordering_org, contact_party, awarded_company, relevance_grade, relevance_score, est_amount, raw)
VALUES
  -- 민간 — 경주 대형 공장 착공(지금 전화, A)
  ('building_permit', 'BP-SAMPLE-001', 'gyeongju', '47130', 'private',
   '경주 외동 OO산업 공장 신축', '경북 경주시 외동읍 모화리 100-1',
   'factory', 'steel', 4200, 189, 'construction_start', CURRENT_DATE - 1,
   NULL, '건축주/시공사', NULL, 'A', 92.0, NULL, '{"sample":true}'::jsonb),

  -- 민간 — 포항 물류창고 허가(모니터링, B)
  ('building_permit', 'BP-SAMPLE-002', 'pohang', '47113', 'private',
   '포항 흥해 물류창고 신축', '경북 포항시 북구 흥해읍 매산리 55',
   'warehouse', 'RC', 3000, 150, 'permit', CURRENT_DATE - 5,
   NULL, '건축주/시공사', NULL, 'B', 58.0, NULL, '{"sample":true}'::jsonb),

  -- 민간 — 울산 근린생활 착공(지금 전화, B)
  ('building_permit', 'BP-SAMPLE-003', 'ulsan', '31140', 'private',
   '울산 무거동 근린생활시설 신축', '울산 남구 무거동 770',
   'neighborhood', 'RC', 1800, 126, 'construction_start', CURRENT_DATE - 2,
   NULL, '건축주/시공사', NULL, 'B', 64.0, NULL, '{"sample":true}'::jsonb),

  -- 민간 — 경주 다가구 허가(C)
  ('building_permit', 'BP-SAMPLE-004', 'gyeongju', '47130', 'private',
   '경주 용강동 다가구주택 신축', '경북 경주시 용강동 1234',
   'multi_family', 'RC', 900, 68, 'permit', CURRENT_DATE - 4,
   NULL, '건축주/시공사', NULL, 'C', 44.0, NULL, '{"sample":true}'::jsonb),

  -- 민간 — 울산 대단지 아파트 허가(감산, C)
  ('building_permit', 'BP-SAMPLE-005', 'ulsan', '31200', 'private',
   '울산 송정 공동주택 신축', '울산 북구 송정동 200',
   'apartment', 'RC', 12000, 1020, 'permit', CURRENT_DATE - 6,
   NULL, '건축주/시공사', NULL, 'C', 20.0, NULL, '{"sample":true}'::jsonb),

  -- 관급 — 포항 도로개설 낙찰(낙찰사에 전화, 시청 아님)
  ('nara_bid', 'NB-SAMPLE-101', 'pohang', NULL, 'public',
   '포항시 OO로 도로개설공사', '경상북도 포항시',
   NULL, NULL, NULL, NULL, 'awarded', CURRENT_DATE - 3,
   '포항시청', '대성건설(주)', '대성건설(주)', 'C', 28.5, 1850000000, '{"sample":true}'::jsonb),

  -- 관급 — 울산 하천정비 입찰공고(낙찰 전)
  ('nara_bid', 'NB-SAMPLE-102', 'ulsan', NULL, 'public',
   '울산 OO천 정비공사', '울산광역시',
   NULL, NULL, NULL, NULL, 'bid_notice', CURRENT_DATE - 2,
   '울산광역시청', '낙찰 전 — 연락 대상 미정', NULL, 'C', 28.5, 2300000000, '{"sample":true}'::jsonb),

  -- 관급 — 경주 산단 진입도로 낙찰(낙찰사에 전화)
  ('nara_bid', 'NB-SAMPLE-103', 'gyeongju', NULL, 'public',
   '경주 OO일반산업단지 진입도로 공사', '경상북도 경주시',
   NULL, NULL, NULL, NULL, 'awarded', CURRENT_DATE - 1,
   '경주시청', '신라토건(주)', '신라토건(주)', 'C', 28.5, 4200000000, '{"sample":true}'::jsonb)
ON CONFLICT (source, source_key) DO NOTHING;
