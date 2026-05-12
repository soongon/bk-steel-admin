# 시스템 DB 스키마 v0 (Supabase / Postgres)

> 5월 워크북에서 추출한 도메인 룰을 그대로 옮긴 DB 스키마 초안. 6월 시스템 개발 시 시작점.
>
> v0 = 5월 1일 베이스라인. 5월 동안 워크북이 진화하면 v0.1, v0.2... 로 증분.
> 6월 1일 시점의 v0.x를 v1으로 동결하고 마이그레이션 스크립트화.

---

## 설계 원칙

1. **사업자 차원은 모든 거래 테이블에 `entity_id` FK** — 법인/사업자(SL철강) 분리.
2. **B계좌 거래는 별도 컬럼 + RLS** — 친구만 read·write, 본인은 read 권한 (감사용).
3. **미수금/미지급금은 generated column** — 수동 계산 X.
4. **상태는 view 또는 generated column** — 입력은 트리거 컬럼만, 상태는 파생.
5. **거래처명 대신 FK** — 워크북의 거래처명 string 매칭은 시스템에서는 `customer_id`/`supplier_id`.

---

## 핵심 enum

```sql
CREATE TYPE entity_kind AS ENUM ('CORPORATION', 'SOLE_PROPRIETOR');
CREATE TYPE bank_account_code AS ENUM ('CORP_A', 'SOLE_A', 'SOLE_B', 'CASH', 'NOTE');
CREATE TYPE payment_term AS ENUM (
  'IMMEDIATE', 'CASH',
  'CREDIT_1D', 'CREDIT_3D', 'CREDIT_7D', 'CREDIT_15D',
  'CREDIT_30D', 'CREDIT_60D', 'CREDIT_90D',
  'NOTE_60D', 'NOTE_90D'
);
CREATE TYPE sales_status AS ENUM ('ORDER', 'DELIVERED', 'PAID', 'OVERDUE');
CREATE TYPE purchase_status AS ENUM ('ORDERED', 'RECEIVED', 'SETTLED', 'OVERDUE');
CREATE TYPE outstanding_grade AS ENUM ('NORMAL', 'SHORT', 'MID', 'LONG');
CREATE TYPE party_kind AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH', 'PROSPECT');
CREATE TYPE activity_kind AS ENUM (
  'CALL', 'VISIT', 'QUOTE', 'KAKAO', 'SMS',
  'CARD_GIVEN', 'CARD_RECEIVED', 'COLD_VISIT', 'OTHER'
);
CREATE TYPE activity_outcome AS ENUM ('IN_PROGRESS', 'WON', 'LOST', 'ON_HOLD');
CREATE TYPE expense_category AS ENUM (
  'MEAL', 'VEHICLE', 'PROMOTION', 'OFFICE',
  'SHIPPING', 'TELECOM', 'ENTERTAINMENT', 'CEREMONY', 'OTHER'
);
CREATE TYPE recurring_category AS ENUM (
  'VEHICLE', 'TAX', 'FACILITY', 'PERSONNEL', 'RELATIONSHIP', 'FINANCE', 'OTHER'
);
CREATE TYPE recurring_status AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'DELAYED', 'ON_HOLD');
```

---

## 테이블

### entities — 사업자 마스터

```sql
CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,           -- '법인', '사업자'
  name TEXT NOT NULL,                   -- 'SH철강 주식회사', 'SL철강 (개인사업자)'
  kind entity_kind NOT NULL,
  business_number TEXT,
  representative TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO entities (code, name, kind) VALUES
  ('법인', 'SH철강 주식회사', 'CORPORATION'),
  ('사업자', 'SL철강 (친구 개인사업자)', 'SOLE_PROPRIETOR');
```

---

### bank_accounts — 통장 마스터

```sql
CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code bank_account_code UNIQUE NOT NULL,
  entity_id UUID NOT NULL REFERENCES entities(id),
  bank_name TEXT,
  account_number TEXT,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,  -- B계좌만 TRUE
  starting_balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- B계좌 = 사업자 + is_hidden=TRUE
```

---

### parties — 거래처/매입처 마스터

```sql
CREATE TABLE parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind party_kind NOT NULL,
  name TEXT NOT NULL,
  representative TEXT,
  contact TEXT,
  business_number TEXT,
  address TEXT,
  preferred_payment_term payment_term,
  preferred_entity_id UUID REFERENCES entities(id),
  start_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, kind)                   -- "OO건설" 매출처와 매입처 동시 가능
);

CREATE INDEX idx_parties_name ON parties(name);
```

---

### sales — 매출

```sql
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT GENERATED ALWAYS AS (
    to_char(record_date, 'YYYYMMDD') || '-' ||
    lpad((row_number() OVER (PARTITION BY record_date ORDER BY created_at))::text, 3, '0')
  ) STORED,                            -- 워크북의 YYYYMMDD-NNN 형식
  record_date DATE NOT NULL,
  party_id UUID NOT NULL REFERENCES parties(id),
  entity_id UUID NOT NULL REFERENCES entities(id),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),

  -- 현장 (선택) — 거래처와 별개로 현장 단위 추적
  site_name TEXT,

  -- 품목
  product TEXT NOT NULL,
  spec TEXT,
  unit TEXT,
  quantity NUMERIC,
  unit_price NUMERIC,                  -- 단가 — null 가능 (배달비 포함된 행은 supply_amount만 직접 입력)
  supply_amount NUMERIC NOT NULL,      -- 공급가 (부가세 신고 기준)
  vat NUMERIC GENERATED ALWAYS AS (
    CASE
      WHEN bank_account_id IN (SELECT id FROM bank_accounts WHERE is_hidden) THEN 0
      ELSE ROUND(supply_amount * 0.1)
    END
  ) STORED,
  total_amount NUMERIC GENERATED ALWAYS AS (supply_amount + vat) STORED,
  delivery_confirmation_sent BOOLEAN DEFAULT FALSE,  -- 납품확인서송부

  -- 결제
  payment_term payment_term NOT NULL,
  delivery_date DATE,
  due_date DATE GENERATED ALWAYS AS (
    CASE payment_term
      WHEN 'IMMEDIATE' THEN delivery_date
      WHEN 'CASH' THEN delivery_date
      WHEN 'CREDIT_1D' THEN delivery_date + 1
      WHEN 'CREDIT_3D' THEN delivery_date + 3
      WHEN 'CREDIT_7D' THEN delivery_date + 7
      WHEN 'CREDIT_15D' THEN delivery_date + 15
      WHEN 'CREDIT_30D' THEN delivery_date + 30
      WHEN 'CREDIT_60D' THEN delivery_date + 60
      WHEN 'CREDIT_90D' THEN delivery_date + 90
      WHEN 'NOTE_60D' THEN delivery_date + 60
      WHEN 'NOTE_90D' THEN delivery_date + 90
    END
  ) STORED,

  -- 트리거 (납품·수금)
  delivery_note BOOLEAN DEFAULT FALSE,    -- 거래명세서
  tax_invoice BOOLEAN DEFAULT FALSE,      -- 세금계산서
  payment_received BOOLEAN DEFAULT FALSE, -- 수금완료
  photo_sent BOOLEAN DEFAULT FALSE,       -- 사진전송

  -- 파생
  outstanding_amount NUMERIC GENERATED ALWAYS AS (
    CASE
      WHEN amount IS NULL OR amount = 0 THEN 0
      WHEN payment_received THEN 0
      WHEN delivery_note OR tax_invoice OR
           bank_account_id IN (SELECT id FROM bank_accounts WHERE is_hidden)
        THEN amount
      ELSE 0
    END
  ) STORED,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sales_record_date ON sales(record_date);
CREATE INDEX idx_sales_party ON sales(party_id);
CREATE INDEX idx_sales_outstanding ON sales(outstanding_amount) WHERE outstanding_amount > 0;
```

상태는 view로:

```sql
CREATE VIEW sales_with_status AS
SELECT s.*,
  CASE
    WHEN s.payment_received THEN 'PAID'::sales_status
    WHEN s.delivery_note OR s.tax_invoice OR ba.is_hidden THEN
      CASE WHEN s.due_date IS NOT NULL AND s.due_date < CURRENT_DATE
           THEN 'OVERDUE' ELSE 'DELIVERED' END
    ELSE 'ORDER'
  END AS status,
  CASE
    WHEN s.outstanding_amount = 0 THEN NULL
    WHEN s.due_date IS NULL OR s.due_date >= CURRENT_DATE THEN 'NORMAL'::outstanding_grade
    WHEN s.due_date >= CURRENT_DATE - 7 THEN 'SHORT'
    WHEN s.due_date >= CURRENT_DATE - 30 THEN 'MID'
    ELSE 'LONG'
  END AS outstanding_grade
FROM sales s
JOIN bank_accounts ba ON ba.id = s.bank_account_id;
```

---

### purchases — 매입 (sales와 대칭 구조)

```sql
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT GENERATED ALWAYS AS (...) STORED,  -- sales와 동일 패턴
  record_date DATE NOT NULL,
  party_id UUID NOT NULL REFERENCES parties(id),
  entity_id UUID NOT NULL REFERENCES entities(id),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),

  product_code TEXT,                   -- 매입처 SKU/제품번호 — null 가능
  product TEXT NOT NULL,
  spec TEXT,
  dimensions TEXT NOT NULL,            -- 칫수 (필수)
  unit TEXT,
  quantity NUMERIC,
  weight NUMERIC,                      -- 중량
  unit_price NUMERIC,                  -- 단가 — null 가능
  supply_amount NUMERIC NOT NULL,      -- 공급가 (부가세 신고 기준)
  vat NUMERIC GENERATED ALWAYS AS (ROUND(supply_amount * 0.1)) STORED,
  total_amount NUMERIC GENERATED ALWAYS AS (supply_amount + ROUND(supply_amount * 0.1)) STORED,

  payment_term payment_term NOT NULL,
  receive_date DATE,
  due_date DATE GENERATED ALWAYS AS (...) STORED,  -- sales 동일

  delivery_note_received BOOLEAN DEFAULT FALSE,
  tax_invoice_received BOOLEAN DEFAULT FALSE,
  tax_invoice_number TEXT,
  payment_settled BOOLEAN DEFAULT FALSE,

  outstanding_amount NUMERIC GENERATED ALWAYS AS (...) STORED,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

### inventory — 재고

```sql
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product TEXT NOT NULL,
  spec TEXT NOT NULL,
  unit TEXT NOT NULL,
  entity_id UUID NOT NULL REFERENCES entities(id),
  current_quantity NUMERIC NOT NULL DEFAULT 0,
  minimum_quantity NUMERIC NOT NULL DEFAULT 0,
  average_unit_price NUMERIC,
  last_in_date DATE,
  last_out_date DATE,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(product, spec, entity_id)
);

-- 재고가치는 generated
ALTER TABLE inventory ADD COLUMN value NUMERIC
  GENERATED ALWAYS AS (current_quantity * average_unit_price) STORED;
```

추후: 매출/매입 발생 시 트리거로 자동 업데이트 (워크북에서 못 한 것).

---

### bank_transactions — 통장

```sql
CREATE TABLE bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  description TEXT NOT NULL,
  deposit NUMERIC NOT NULL DEFAULT 0,
  withdrawal NUMERIC NOT NULL DEFAULT 0,
  category TEXT,
  matched_sale_id UUID REFERENCES sales(id),
  matched_purchase_id UUID REFERENCES purchases(id),
  matched_expense_id UUID,             -- expenses 테이블 추가 후
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (deposit >= 0 AND withdrawal >= 0),
  CHECK (NOT (deposit > 0 AND withdrawal > 0))
);

CREATE INDEX idx_bank_tx_account_date ON bank_transactions(bank_account_id, date);
```

잔고는 view:

```sql
CREATE VIEW bank_balance_running AS
SELECT bt.*,
  ba.starting_balance + SUM(bt.deposit - bt.withdrawal)
    OVER (PARTITION BY bt.bank_account_id ORDER BY bt.date, bt.created_at) AS running_balance
FROM bank_transactions bt
JOIN bank_accounts ba ON ba.id = bt.bank_account_id;
```

---

### expenses — 영수증 (워크북의 4.영수증)

```sql
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT GENERATED ALWAYS AS (
    'REC-' || to_char(date, 'YYYYMMDD') || '-' || ...
  ) STORED,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  category expense_category NOT NULL,
  amount NUMERIC NOT NULL,
  entity_id UUID NOT NULL REFERENCES entities(id),
  receipt_url TEXT,                    -- Supabase Storage 첨부
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

### recurring_tasks — 정기업무

```sql
CREATE TABLE recurring_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category recurring_category NOT NULL,
  name TEXT NOT NULL,
  period_code TEXT NOT NULL,           -- '매월 25일', '매년 8월', etc
  last_executed_at DATE,
  next_due_at DATE NOT NULL,
  assignee TEXT,                       -- '본인', '친구', '직원', '세무사'
  status recurring_status NOT NULL DEFAULT 'PENDING',
  expected_cost NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_recurring_due ON recurring_tasks(next_due_at) WHERE status != 'DONE';
```

5월 워크북의 25개 preset → seed 스크립트로 INSERT.

---

### sales_activities — 영업내역 (워크북의 9.영업내역)

```sql
CREATE TABLE sales_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT GENERATED ALWAYS AS (...) STORED,  -- YYYYMMDD-NNN

  activity_date DATE NOT NULL,
  party_id UUID NOT NULL REFERENCES parties(id),  -- PROSPECT/CUSTOMER 모두 가능
  activity_kind activity_kind NOT NULL,

  location TEXT,                       -- 콜드 prospecting의 현장 위치
  owner_user_id UUID REFERENCES users(id),  -- 본인/친구/직원

  -- 예상 거래 (선택)
  product TEXT,
  spec TEXT,
  expected_quantity NUMERIC,
  expected_amount NUMERIC,

  -- 진행
  outcome activity_outcome NOT NULL DEFAULT 'IN_PROGRESS',
  sale_id UUID REFERENCES sales(id),   -- outcome=WON일 때 매출 FK
  next_followup_at DATE,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_activities_date ON sales_activities(activity_date);
CREATE INDEX idx_activities_party ON sales_activities(party_id);
CREATE INDEX idx_activities_outcome ON sales_activities(outcome);
CREATE INDEX idx_activities_followup ON sales_activities(next_followup_at)
  WHERE outcome = 'IN_PROGRESS';
```

**워크북 → 시스템 매핑 시 주의**:
- 워크북의 자유텍스트 `거래처/잠재처` → 마이그레이션 스크립트가 `parties` 테이블에 dedup INSERT (이름 매칭, 미존재면 `kind=PROSPECT`로 신규 생성).
- 워크북의 `등록여부` 컬럼은 시스템에선 제거 — `parties.kind`로 자연스럽게 흡수.
- 워크북의 `매출ID` (text) → 시스템의 `sale_id` (UUID FK).

파이프라인 view (거래처별 현재 상태):

```sql
CREATE VIEW party_pipeline AS
SELECT p.id, p.name, p.kind,
  COUNT(*) FILTER (WHERE sa.outcome = 'IN_PROGRESS') AS in_progress_count,
  COUNT(*) FILTER (WHERE sa.outcome = 'WON') AS won_count,
  COUNT(*) FILTER (WHERE sa.outcome = 'LOST') AS lost_count,
  MAX(sa.activity_date) AS last_activity_at,
  MIN(sa.next_followup_at) FILTER (WHERE sa.outcome = 'IN_PROGRESS') AS next_followup_at
FROM parties p
LEFT JOIN sales_activities sa ON sa.party_id = p.id
GROUP BY p.id, p.name, p.kind;
```

---

### contacts — 명함 (워크북 10.명함)

```sql
CREATE TYPE contact_status AS ENUM (
  'PENDING', 'FOLLOWUP', 'PROMOTED', 'LOST', 'ON_HOLD'
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT GENERATED ALWAYS AS (
    'CARD-' || to_char(received_at, 'YYYYMMDD') || '-' || ...
  ) STORED,

  name TEXT NOT NULL,                       -- 필수
  company_id UUID REFERENCES parties(id),   -- 정식 거래처와 매핑
  company_text TEXT,                         -- 자유 텍스트 (콜드, 마스터 미등록)

  title TEXT,                                -- 직책
  phone TEXT,                                -- 핸드폰
  email TEXT,
  company_phone TEXT,                        -- 회사전화
  address TEXT,

  card_image_url TEXT,                       -- Supabase Storage 명함 사진
  card_image_ocr_data JSONB,                 -- OCR 파싱 결과 (이름/회사/직책/연락처)

  received_at DATE NOT NULL,
  received_location TEXT,
  received_via_activity_id UUID REFERENCES sales_activities(id),

  status contact_status NOT NULL DEFAULT 'PENDING',
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_contacts_received_at ON contacts(received_at);
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_contacts_status ON contacts(status);
CREATE INDEX idx_contacts_phone ON contacts(phone);

-- 9.영업내역에 명함 FK
ALTER TABLE sales_activities
  ADD COLUMN contact_id UUID REFERENCES contacts(id);
```

**워크북 → 시스템 매핑 시 주의**:
- 워크북 `회사` 컬럼 자유 텍스트 → 마이그레이션 시 5.거래처 마스터와 fuzzy matching → company_id (매칭 실패 시 company_text에 보존)
- 워크북 `활동ID` → sales_activities FK (received_via_activity_id)

### contact_with_company view (회사 표시 통합)

```sql
CREATE VIEW contact_with_company AS
SELECT
  c.*,
  COALESCE(p.name, c.company_text) AS company_display,
  p.kind AS company_kind
FROM contacts c
LEFT JOIN parties p ON p.id = c.company_id;
```

### 명함 → 거래처 promote 함수

```sql
CREATE OR REPLACE FUNCTION promote_contact_to_party(contact_id UUID, party_kind party_kind)
RETURNS UUID AS $$
DECLARE new_party_id UUID;
BEGIN
  -- contact의 company_text를 parties로 INSERT
  INSERT INTO parties (kind, name, ...)
  SELECT party_kind, c.company_text, ...
  FROM contacts c WHERE c.id = contact_id
  RETURNING id INTO new_party_id;

  -- contact 갱신
  UPDATE contacts
  SET company_id = new_party_id, status = 'PROMOTED'
  WHERE id = contact_id;

  RETURN new_party_id;
END;
$$ LANGUAGE plpgsql;
```

---

### improvement_ideas — 0.개선아이디어

```sql
CREATE TABLE improvement_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  area TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT,                       -- '상', '중', '하'
  status TEXT,                         -- '대기', '검토중', '반영예정', '반영완료', '보류'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

5월 운영 중 누적된 아이디어 → 6월 시스템 개발 백로그.

---

## RLS (Row Level Security) 정책

```sql
-- 본인은 모든 데이터 접근 가능
-- 친구는 본인 사업자 데이터(사업자A, B계좌) 모두 접근
-- 직원은 사업자A만 (B계좌 차단)

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_owner_full ON bank_transactions
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM users WHERE role = 'OWNER'));

CREATE POLICY bank_friend_full ON bank_transactions
  FOR ALL USING (
    auth.uid() IN (SELECT user_id FROM users WHERE role = 'PARTNER')
  );

CREATE POLICY bank_staff_visible ON bank_transactions
  FOR SELECT USING (
    auth.uid() IN (SELECT user_id FROM users WHERE role = 'STAFF')
    AND bank_account_id NOT IN (SELECT id FROM bank_accounts WHERE is_hidden)
  );
```

매출/매입/영수증에도 동일 패턴 적용.

---

## 인덱스 전략

| 테이블 | 인덱스 | 용도 |
|---|---|---|
| sales | (record_date) | 월별 조회 |
| sales | (party_id) | 거래처별 |
| sales | (outstanding_amount) WHERE > 0 | 미수 대시보드 |
| purchases | (party_id) | 매입처별 |
| bank_transactions | (bank_account_id, date) | 잔고 계산 |
| recurring_tasks | (next_due_at) WHERE status != 'DONE' | 임박 알림 |

---

## 마이그레이션 (CSV → Postgres)

```sql
-- 5월 31일 마지막 sync 후 실행
COPY entities FROM '/path/to/seed/entities.csv' CSV HEADER;
COPY bank_accounts FROM '...' CSV HEADER;
COPY parties FROM '...' CSV HEADER;
COPY sales FROM '...' CSV HEADER;
-- ...
```

**주의**: workbook의 거래처명 string은 INSERT 전에 `parties` 테이블 PK로 매핑 작업 필요. 스크립트로 자동화.

---

## v0 → v1 변경 시 추가 사항

5월 운영 중 발견될 가능성:
- 어음 전용 테이블 (만기일·발행일 분리)
- 거래처별 신용 한도 컬럼
- 직원별 KPI 테이블
- 폴리싱 작업 추적
- 차량별 운행 일지

`docs/워크북_변경이력.md`의 변경 이력을 그대로 v1으로 옮길 것.
