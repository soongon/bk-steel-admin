-- ============================================================
-- 0015_price_autofill_trigger.sql
-- 매입 라인 INSERT 시 price_history에 자동 누적 (source='purchase_derived')
-- purchase_line 정의 후에만 trigger 가능하므로 분리
-- 참조: docs/시스템_DB_스키마_v1.md §14
-- ============================================================

CREATE OR REPLACE FUNCTION price_history_autofill_from_purchase()
RETURNS TRIGGER AS $$
DECLARE
  v_market_item    UUID;
  v_price_per_kg   NUMERIC;
  v_recorded_on    DATE;
  v_actor          UUID;
BEGIN
  -- 1. 이 품목이 어느 market_item에 속하는지 lookup
  SELECT i.market_item_id INTO v_market_item
    FROM item i WHERE i.id = NEW.item_id;
  IF v_market_item IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. 매입 헤더에서 입고일 + actor 조회
  SELECT p.delivered_on, p.created_by
    INTO v_recorded_on, v_actor
    FROM purchase p WHERE p.id = NEW.purchase_id;
  IF v_recorded_on IS NULL THEN
    RETURN NEW;  -- 미입고면 시세 누적 skip
  END IF;

  -- 3. 단가를 kg 기준으로 환산
  IF NEW.acquired_unit = 'kg' THEN
    v_price_per_kg := NEW.unit_price_krw;
  ELSIF NEW.acquired_unit = 'ton' THEN
    v_price_per_kg := NEW.unit_price_krw / 1000;
  ELSIF NEW.theoretical_weight_kg IS NOT NULL AND NEW.acquired_qty > 0 THEN
    v_price_per_kg := (NEW.unit_price_krw * NEW.acquired_qty) / NEW.theoretical_weight_kg;
  ELSE
    RETURN NEW;
  END IF;

  -- 4. price_history에 INSERT (충돌 시 무시)
  INSERT INTO price_history
    (market_item_id, recorded_on, price_per_unit, unit, price_type, source, source_label, recorded_by)
  VALUES
    (v_market_item, v_recorded_on, v_price_per_kg, 'kg', 'spot', 'purchase_derived',
     NEW.purchase_id::TEXT, v_actor)
  ON CONFLICT (market_item_id, recorded_on, source, price_type) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_price_autofill_from_purchase ON purchase_line;
CREATE TRIGGER trg_price_autofill_from_purchase
  AFTER INSERT ON purchase_line
  FOR EACH ROW EXECUTE FUNCTION price_history_autofill_from_purchase();
