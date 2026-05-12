-- ============================================================
-- 0003_market_item.sql — 시세 분류 큐레이션 (운영 시점 정리)
-- 큐레이션 목록은 친구가 자주 다루는 품목군 기준으로 조정 가능
-- 참조: docs/시스템_도메인_룰_v1.md §7
-- ============================================================

INSERT INTO market_item (code, label_ko, category, default_unit, display_order) VALUES
  -- 철근 (시장 통용 단위는 kg, 거래는 톤/가닥)
  ('rebar_d10',    '철근 D10',   'rebar', 'kg', 10),
  ('rebar_d13',    '철근 D13',   'rebar', 'kg', 11),
  ('rebar_d16',    '철근 D16',   'rebar', 'kg', 12),
  ('rebar_d19',    '철근 D19',   'rebar', 'kg', 13),
  ('rebar_d22',    '철근 D22',   'rebar', 'kg', 14),
  ('rebar_d25',    '철근 D25',   'rebar', 'kg', 15),
  ('rebar_d29',    '철근 D29',   'rebar', 'kg', 16),
  ('rebar_d32',    '철근 D32',   'rebar', 'kg', 17),

  -- H빔 (사이즈별)
  ('hbeam_200x100','H빔 200×100','hbeam', 'kg', 30),
  ('hbeam_250x125','H빔 250×125','hbeam', 'kg', 31),
  ('hbeam_300x150','H빔 300×150','hbeam', 'kg', 32),

  -- 각파이프 (사이즈·두께별 — 운영 시 자주 쓰는 규격으로 정리)
  ('pipe_sq_50x2_3','각파이프 50×50×2.3','pipe', 'kg', 50),
  ('pipe_sq_75x3_2','각파이프 75×75×3.2','pipe', 'kg', 51),

  -- 고철 (생철 / 슬래그 / 절단철 등으로 세분화 가능)
  ('scrap_iron',   '고철 (생철)','scrap', 'kg', 80),
  ('scrap_used_rebar', '폴리싱 중고 철근', 'scrap', 'kg', 81)
ON CONFLICT (code) DO UPDATE SET
  label_ko      = EXCLUDED.label_ko,
  category      = EXCLUDED.category,
  default_unit  = EXCLUDED.default_unit,
  display_order = EXCLUDED.display_order;
