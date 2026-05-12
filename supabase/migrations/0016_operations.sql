-- ============================================================
-- 0016_operations.sql
-- 운영 테이블: 영업내역, 명함, 정기업무, 개선 아이디어
-- 참조: docs/시스템_DB_스키마_v1.md §15
-- ============================================================

-- ============================================================
-- 영업 콜드 prospecting
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contacted_on    DATE NOT NULL,
  partner_id      UUID REFERENCES partner(id),      -- 등록 거래처면 매핑
  prospect_name   TEXT,                              -- 미등록 잠재 거래처 자유 텍스트
  contact_person  TEXT,
  channel         TEXT,                              -- 'phone','visit','email','sms'
  result          TEXT,
  follow_up_on    DATE,
  notes           TEXT,
  created_by      UUID REFERENCES user_profile(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sales_log_partner ON sales_log(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_log_followup ON sales_log(follow_up_on)
  WHERE follow_up_on IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_sales_log_updated_at ON sales_log;
CREATE TRIGGER trg_sales_log_updated_at
  BEFORE UPDATE ON sales_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 명함
-- ============================================================
CREATE TABLE IF NOT EXISTS business_card (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_on  DATE,
  partner_id    UUID REFERENCES partner(id),
  name          TEXT NOT NULL,
  title         TEXT,
  company       TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  image_url     TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_business_card_partner ON business_card(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_business_card_name_trgm ON business_card USING gin (name gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_business_card_updated_at ON business_card;
CREATE TRIGGER trg_business_card_updated_at
  BEFORE UPDATE ON business_card
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 정기업무
-- ============================================================
CREATE TABLE IF NOT EXISTS recurring_task (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  cadence       TEXT NOT NULL,                      -- 'daily','weekly','monthly','yearly','adhoc'
  due_rule      TEXT,                                -- '매월 10일' 등 사람용 설명
  owner         UUID REFERENCES user_profile(user_id),
  related_book  book_type,
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_recurring_task_updated_at ON recurring_task;
CREATE TRIGGER trg_recurring_task_updated_at
  BEFORE UPDATE ON recurring_task
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS recurring_task_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES recurring_task(id) ON DELETE CASCADE,
  done_on     DATE NOT NULL,
  done_by     UUID REFERENCES user_profile(user_id),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_task_log_task ON recurring_task_log(task_id, done_on DESC);

-- ============================================================
-- 개선 아이디어
-- ============================================================
CREATE TABLE IF NOT EXISTS improvement_idea (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT,                                -- 'system','process','sales','operations'
  status        TEXT NOT NULL DEFAULT 'open',
  priority      TEXT,
  proposed_by   UUID REFERENCES user_profile(user_id),
  proposed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_improvement_status ON improvement_idea(status, proposed_at DESC);
