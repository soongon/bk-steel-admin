-- ============================================================
-- 0001_rebar_spec.sql — KS D 3504 이형철근 단위중량 시드
-- 참조: docs/철근_제품마스터.md §1
-- ============================================================

INSERT INTO rebar_spec
  (spec_code, nominal_diameter_mm, nominal_area_mm2, unit_weight_kg_per_m,
   standard_length_m, bars_per_bundle, bundle_weight_kg, display_order)
VALUES
  ('D10', 9.53,   71.33, 0.560, 8, 420, 1881.60,  1),
  ('D13', 12.70, 126.70, 0.995, 8, 250, 1990.00,  2),
  ('D16', 15.90, 198.60, 1.560, 8, 150, 1872.00,  3),
  ('D19', 19.10, 286.50, 2.250, 8, 100, 1800.00,  4),
  ('D22', 22.20, 387.10, 3.040, 8,  80, 1945.60,  5),
  ('D25', 25.40, 506.70, 3.980, 8,  60, 1910.40,  6),
  ('D29', 28.60, 642.40, 5.040, 8,  50, 2016.00,  7),
  ('D32', 31.80, 794.20, 6.230, 8,  40, 1993.60,  8),
  ('D35', 34.90, 956.60, 7.510, 8,  30, 1802.40,  9),
  ('D38', 38.10, 1140.00, 8.950, 8, 25, 1790.00, 10),
  ('D41', 41.30, 1340.00, 10.500, 8, NULL, NULL, 11),
  ('D51', 50.80, 2027.00, 15.900, 8, NULL, NULL, 12)
ON CONFLICT (spec_code) DO UPDATE SET
  nominal_diameter_mm  = EXCLUDED.nominal_diameter_mm,
  nominal_area_mm2     = EXCLUDED.nominal_area_mm2,
  unit_weight_kg_per_m = EXCLUDED.unit_weight_kg_per_m,
  standard_length_m    = EXCLUDED.standard_length_m,
  bars_per_bundle      = EXCLUDED.bars_per_bundle,
  bundle_weight_kg     = EXCLUDED.bundle_weight_kg,
  display_order        = EXCLUDED.display_order;
