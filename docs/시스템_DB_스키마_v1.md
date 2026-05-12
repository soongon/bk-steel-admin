# 시스템 DB 스키마 v1

> Supabase(PostgreSQL 15+) 기준. `docs/시스템_도메인_룰_v1.md` 확정본 + `docs/철근_제품마스터.md` 기반.
> 이 문서는 **스키마 청사진**이며 마이그레이션 SQL은 별도(`/supabase/migrations/`)에서 점진 적용한다.

---

## 0. 설계 원칙

1. **모든 거래성 row에 `book` NOT NULL** — 책 분리 강제
2. **PK는 UUID**(`gen_random_uuid()`), FK는 모두 UUID 참조
3. **공통 컬럼**: `created_at`, `updated_at`, `deleted_at`(soft delete), `created_by`, `updated_by`
4. **Soft delete만 허용** — 거래성 row는 절대 hard delete 금지 (audit 보존)
5. **CHECK constraint로 도메인 룰 강제** (BK 자료성, BK↔B 차단, 이관 시가 근거 등)
6. **RLS는 모든 거래성 테이블에 적용** — 책 단위 격리
7. **audit_log는 트리거로 자동 기록** — INSERT/UPDATE/DELETE 모두
8. **재고는 view로 계산** — `purchase_line` ledger ↔ `sale_line_allocation`의 차이
9. **명명**: snake_case + 한글 주석. 한국어는 enum 값/상태 등 도메인 정체성 강한 곳에 한해 코드도 영문화

---

## 1. Enum 타입 정의

```sql
-- 책 (3축)
CREATE TYPE book_type AS ENUM ('bk', 'sl', 'b');

-- 자료 종류
CREATE TYPE tax_doc_type AS ENUM (
  'tax_invoice_electronic',  -- 전자세금계산서 (기본)
  'tax_invoice_paper',       -- 종이세금계산서
  'invoice',                 -- 계산서 (면세)
  'cash_receipt',            -- 현금영수증
  'simple_receipt',          -- 간이영수증
  'none'                     -- 무자료
);

-- 거래 단위
CREATE TYPE acquired_unit AS ENUM ('ton', 'kg', 'ea', 'piece', 'bundle', 'set');

-- 단가 기준 (이론/실)
CREATE TYPE price_basis AS ENUM ('theoretical', 'actual');

-- 매입 상태머신
CREATE TYPE purchase_status AS ENUM (
  'ordered',           -- 발주 완료, 미입고
  'in_stock',          -- 입고 완료, 재고 보유
  'partial_out',       -- 일부 출고됨
  'depleted',          -- 전량 출고
  'transferred_out',   -- 책 간 이관으로 빠짐
  'scrapped'           -- 폐기
);

-- 매출 상태머신
CREATE TYPE sale_status AS ENUM (
  'reserved',          -- 매출 예약, 미출고
  'confirmed',         -- 매출 확정
  'delivered',         -- 납품 완료
  'settled',           -- 수금 완료
  'overdue',           -- 수금 연체
  'cancelled'          -- 취소
);

-- 매출 거래 subtype (외부 vs 책 간)
CREATE TYPE sale_subtype AS ENUM (
  'external',              -- 외부 매출
  'inter_book_transfer',   -- BK↔SL 이관의 매출 측
  'internal_reclass'       -- SL↔B 재분류의 출고 측
);
CREATE TYPE purchase_subtype AS ENUM (
  'external',
  'inter_book_transfer',
  'internal_reclass'
);

-- 재고 조정 사유
CREATE TYPE inventory_adjustment_type AS ENUM (
  'cut',          -- 절단/가공 (parent → children)
  'split',        -- 분할
  'merge',        -- 병합
  'stocktake',    -- 재고실사 차이 조정
  'loss',         -- 감모/유실
  'scrap',        -- 폐기
  'return_in',   -- 반품 입고 (수동 처리, v1)
  'return_out'   -- 반품 출고 (수동 처리, v1)
);

-- 통장 종류
CREATE TYPE bank_account_kind AS ENUM (
  'corporate',  -- 법인 통장
  'personal',   -- 사업자 개인 통장
  'b_hidden'    -- B계좌 (무자료)
);

-- 미수 등급 (계산용 enum 또는 view에서 처리)
CREATE TYPE receivable_grade AS ENUM ('normal', 'short', 'mid', 'long');
-- normal: 예정일 미도래 / short: 1~7일 / mid: 8~30일 / long: 31일+

-- 시세 종류
CREATE TYPE price_type AS ENUM ('wholesale', 'retail', 'scrap', 'spot');
CREATE TYPE price_source AS ENUM ('manual', 'external', 'purchase_derived');

-- 창고 종류
CREATE TYPE warehouse_kind AS ENUM ('owned', 'partner');

-- 사용자 역할 (책 × 권한)
CREATE TYPE book_role AS ENUM ('owner', 'manager', 'staff', 'accountant', 'viewer');
```

---

## 2. 사용자 / 권한

Supabase `auth.users` 위에 `user_profile` + `user_book_role` 매트릭스.

```sql
CREATE TABLE user_profile (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone TEXT,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,  -- 50:50 동업 본인 1명만 TRUE
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_book_role (
  user_id UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
  book book_type NOT NULL,
  role book_role NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID REFERENCES user_profile(user_id),
  PRIMARY KEY (user_id, book)
);

-- 헬퍼 함수: 현재 유저가 특정 책의 특정 권한을 가지나
CREATE OR REPLACE FUNCTION current_user_has_book_role(
  p_book book_type,
  p_min_role book_role
) RETURNS BOOLEAN AS $$
DECLARE
  user_role book_role;
BEGIN
  SELECT role INTO user_role
    FROM user_book_role
   WHERE user_id = auth.uid() AND book = p_book;

  IF user_role IS NULL THEN RETURN FALSE; END IF;

  RETURN CASE p_min_role
    WHEN 'viewer'     THEN TRUE
    WHEN 'staff'      THEN user_role IN ('staff','manager','owner','accountant')
    WHEN 'accountant' THEN user_role IN ('accountant','manager','owner')
    WHEN 'manager'    THEN user_role IN ('manager','owner')
    WHEN 'owner'      THEN user_role = 'owner'
  END;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

### 권한 매트릭스 (운영 룰)
| 역할 | BK | SL | B |
|---|:-:|:-:|:-:|
| 본인(owner) | owner | owner | owner |
| 친구(SL 대표) | viewer | owner | owner |
| 직원 | — | staff (제한) | — |
| 회계사 | accountant | accountant | — |

---

## 3. 마스터 — 공유

### 3.1 거래처 (`partner`)

```sql
CREATE TABLE partner (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,        -- 'P001' 등
  name TEXT NOT NULL,               -- 표준 거래처명 (매출/매입 정합성 기준)
  business_no TEXT,                 -- 사업자등록번호
  representative TEXT,
  phone TEXT, fax TEXT,
  address TEXT,
  industry TEXT,                    -- 업종
  notes TEXT,

  -- 책별 신용한도 (별도 테이블로 분리)
  -- partner_credit_limit 참조

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id),
  updated_by UUID REFERENCES user_profile(user_id)
);

-- 거래처 별칭 (동일 거래처의 다른 표기 흡수)
CREATE TABLE partner_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE (alias)
);

-- 책별 신용한도 (여신)
CREATE TABLE partner_credit_limit (
  partner_id UUID NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  book book_type NOT NULL,
  credit_limit_krw NUMERIC(15,0) NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES user_profile(user_id),
  PRIMARY KEY (partner_id, book)
);

CREATE INDEX idx_partner_active ON partner(is_active) WHERE deleted_at IS NULL;
```

### 3.2 시세 분류 마스터 (`market_item`)

```sql
CREATE TABLE market_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,        -- 'rebar_d13', 'hbeam_200x100', ...
  label_ko TEXT NOT NULL,           -- '철근 D13', 'H빔 200×100'
  category TEXT NOT NULL,           -- 'rebar', 'hbeam', 'pipe', 'scrap', ...
  default_unit acquired_unit NOT NULL DEFAULT 'kg',
  display_order INT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.3 철근 마스터 (`rebar_spec`, `rebar_grade`)

`docs/철근_제품마스터.md` 의 시드 SQL 그대로. 요약:

```sql
CREATE TABLE rebar_spec (
  spec_code TEXT PRIMARY KEY,
  nominal_diameter_mm NUMERIC(5,2) NOT NULL,
  nominal_area_mm2 NUMERIC(8,2) NOT NULL,
  unit_weight_kg_per_m NUMERIC(6,3) NOT NULL,
  standard_length_m INT NOT NULL DEFAULT 8,
  bars_per_bundle INT,
  bundle_weight_kg NUMERIC(8,2),
  display_order INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rebar_grade (
  grade_code TEXT PRIMARY KEY,
  yield_strength_mpa INT NOT NULL,
  category TEXT NOT NULL,
  display_order INT
);
```

### 3.4 품목 마스터 (`item`)

```sql
CREATE TABLE item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,                          -- 'REBAR_D13_SD400_8M'
  name TEXT NOT NULL,                                 -- '철근 D13 SD400 8M'
  category TEXT NOT NULL,                             -- 'rebar', 'hbeam', 'pipe', 'scrap', 'etc'
  market_item_id UUID REFERENCES market_item(id),     -- 시세 추적용

  -- 철근인 경우
  rebar_spec_code TEXT REFERENCES rebar_spec(spec_code),
  rebar_grade_code TEXT REFERENCES rebar_grade(grade_code),
  length_m NUMERIC(5,2),                              -- 가닥 길이 (철근 보통 8m)

  -- 형강/각파이프 등은 향후 별도 ref 테이블 + 컬럼 확장
  spec_text TEXT,                                     -- 자유 텍스트 규격 (legacy/임시)
  weight_per_unit_kg NUMERIC(10,3),                   -- 1단위 표준 중량 (kg/EA 또는 kg/m 등)

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT chk_rebar_consistency CHECK (
    (category = 'rebar' AND rebar_spec_code IS NOT NULL)
    OR (category <> 'rebar' AND rebar_spec_code IS NULL)
  )
);
```

### 3.5 창고 / 야적장 (`warehouse`)

```sql
CREATE TABLE warehouse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  kind warehouse_kind NOT NULL DEFAULT 'owned',
  partner_id UUID REFERENCES partner(id),  -- kind='partner'일 때 필수
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_partner_warehouse CHECK (
    (kind = 'partner' AND partner_id IS NOT NULL)
    OR (kind = 'owned' AND partner_id IS NULL)
  )
);

-- 책별 구획 (Zone)
CREATE TABLE warehouse_zone (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE,
  zone_code TEXT NOT NULL,                        -- 'A','B-1','뒷마당' 등
  preferred_book book_type,                       -- 통상 이 zone에 두는 책 (강제 아님)
  notes TEXT,
  UNIQUE (warehouse_id, zone_code)
);
```

---

## 4. 마스터 — 책 종속

### 4.1 통장 (`bank_account`)

```sql
CREATE TABLE bank_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,                  -- 책 종속
  code TEXT NOT NULL,                       -- '법인A', '사업자A', 'B계좌'
  bank_name TEXT NOT NULL,
  account_number TEXT,                      -- nullable (B계좌는 표시 안 할 수도)
  account_holder TEXT,
  kind bank_account_kind NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (book, code),

  -- 책 ↔ 종류 정합성
  CONSTRAINT chk_bank_kind_book CHECK (
    (book = 'bk' AND kind = 'corporate')
    OR (book = 'sl' AND kind = 'personal')
    OR (book = 'b'  AND kind = 'b_hidden')
  )
);
```

---

## 5. 거래성 — 매입 (`purchase`)

```sql
CREATE TABLE purchase (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  doc_no TEXT UNIQUE NOT NULL,              -- 자동 생성 또는 입력
  partner_id UUID NOT NULL REFERENCES partner(id),

  purchase_subtype purchase_subtype NOT NULL DEFAULT 'external',
  transfer_id UUID,                          -- inter_book_transfer/internal_reclass일 때 book_transfer.id

  ordered_on DATE NOT NULL,
  delivered_on DATE,                         -- 입고일 (NULL이면 ordered 상태)

  -- 자료 정보
  is_documented BOOLEAN NOT NULL,
  tax_doc_type tax_doc_type NOT NULL DEFAULT 'tax_invoice_electronic',
  tax_doc_no TEXT,
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,

  subtotal_krw NUMERIC(15,0) NOT NULL DEFAULT 0,     -- 부가세 별도 합계
  vat_krw NUMERIC(15,0) NOT NULL DEFAULT 0,
  total_krw NUMERIC(15,0) NOT NULL DEFAULT 0,

  payment_due_on DATE,                       -- 결제 예정일
  paid_on DATE,
  pay_bank_account_id UUID REFERENCES bank_account(id),  -- 어느 통장으로 결제

  status purchase_status NOT NULL DEFAULT 'ordered',
  notes TEXT,
  attachments JSONB,                         -- 견적서·계산서 등 파일 URL

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id),
  updated_by UUID REFERENCES user_profile(user_id),

  -- 책별 자료성 강제
  CONSTRAINT chk_bk_documented CHECK (
    book <> 'bk' OR is_documented = TRUE
  ),
  CONSTRAINT chk_b_undocumented CHECK (
    book <> 'b' OR (is_documented = FALSE AND tax_doc_type = 'none')
  ),
  -- BK ↔ B 이관 차단 (purchase_subtype이 transfer일 때, 짝 transfer가 BK↔B면 안 됨; book_transfer에서도 강제)
  CONSTRAINT chk_transfer_id_when_subtype CHECK (
    (purchase_subtype = 'external' AND transfer_id IS NULL)
    OR (purchase_subtype <> 'external' AND transfer_id IS NOT NULL)
  )
);
CREATE INDEX idx_purchase_book_date ON purchase(book, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_partner ON purchase(partner_id);
CREATE INDEX idx_purchase_transfer ON purchase(transfer_id) WHERE transfer_id IS NOT NULL;
```

### 5.1 매입 라인 (`purchase_line`) — piece/lot 역할

```sql
CREATE TABLE purchase_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchase(id) ON DELETE CASCADE,
  book book_type NOT NULL,                      -- 헤더와 동일 (denormalized for RLS·인덱스)
  warehouse_id UUID NOT NULL REFERENCES warehouse(id),
  zone TEXT,                                    -- warehouse_zone.zone_code (free text 허용)
  item_id UUID NOT NULL REFERENCES item(id),

  -- 입고 단위 (매입 시 그대로 보존)
  acquired_unit acquired_unit NOT NULL,
  acquired_qty NUMERIC(15,3) NOT NULL,
  unit_price_krw NUMERIC(15,2) NOT NULL,        -- acquired_unit 기준 단가

  -- 가닥 단위면 채워지는 컬럼
  bars_count INT,                               -- 가닥수
  length_mm INT,                                -- 가닥 길이
  grade TEXT,                                   -- 등급 (SD400 등)

  -- 중량
  theoretical_weight_kg NUMERIC(12,3),
  actual_weight_kg NUMERIC(12,3),
  invoiced_weight_kg NUMERIC(12,3),
  price_basis price_basis NOT NULL DEFAULT 'theoretical',

  -- 합계
  line_subtotal_krw NUMERIC(15,0) NOT NULL,

  status purchase_status NOT NULL DEFAULT 'in_stock',  -- 라인 단위 상태

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- kg 단위 매입이면 실중량 필수
  CONSTRAINT chk_kg_unit_actual_required CHECK (
    acquired_unit <> 'kg' OR actual_weight_kg IS NOT NULL
  )
);
CREATE INDEX idx_purchase_line_book_item ON purchase_line(book, item_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_line_warehouse ON purchase_line(warehouse_id, zone);
CREATE INDEX idx_purchase_line_status ON purchase_line(status);
```

---

## 6. 거래성 — 매출 (`sale`)

```sql
CREATE TABLE sale (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  doc_no TEXT UNIQUE NOT NULL,
  partner_id UUID NOT NULL REFERENCES partner(id),
  site_name TEXT,                               -- 현장명 (거래처와 분리)

  sale_subtype sale_subtype NOT NULL DEFAULT 'external',
  transfer_id UUID,

  ordered_on DATE NOT NULL,
  delivered_on DATE,

  is_documented BOOLEAN NOT NULL,
  tax_doc_type tax_doc_type NOT NULL DEFAULT 'tax_invoice_electronic',
  tax_doc_no TEXT,
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,

  subtotal_krw NUMERIC(15,0) NOT NULL DEFAULT 0,
  vat_krw NUMERIC(15,0) NOT NULL DEFAULT 0,
  total_krw NUMERIC(15,0) NOT NULL DEFAULT 0,

  payment_due_on DATE,                          -- 수금 예정일
  settled_on DATE,                              -- 완납일
  receive_bank_account_id UUID REFERENCES bank_account(id),  -- 수금 통장

  status sale_status NOT NULL DEFAULT 'reserved',
  notes TEXT,
  attachments JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id),
  updated_by UUID REFERENCES user_profile(user_id),

  CONSTRAINT chk_bk_documented_sale CHECK (book <> 'bk' OR is_documented = TRUE),
  CONSTRAINT chk_b_undocumented_sale CHECK (book <> 'b' OR (is_documented = FALSE AND tax_doc_type = 'none')),
  CONSTRAINT chk_sale_transfer_id CHECK (
    (sale_subtype = 'external' AND transfer_id IS NULL)
    OR (sale_subtype <> 'external' AND transfer_id IS NOT NULL)
  )
);
CREATE INDEX idx_sale_book_date ON sale(book, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_sale_partner ON sale(partner_id);
CREATE INDEX idx_sale_transfer ON sale(transfer_id) WHERE transfer_id IS NOT NULL;
```

### 6.1 매출 라인 (`sale_line`)

```sql
CREATE TABLE sale_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sale(id) ON DELETE CASCADE,
  book book_type NOT NULL,
  item_id UUID NOT NULL REFERENCES item(id),

  unit acquired_unit NOT NULL,
  qty NUMERIC(15,3) NOT NULL,
  unit_price_krw NUMERIC(15,2) NOT NULL,
  weight_kg NUMERIC(12,3),

  theoretical_weight_kg NUMERIC(12,3),
  actual_weight_kg NUMERIC(12,3),
  invoiced_weight_kg NUMERIC(12,3),
  price_basis price_basis NOT NULL DEFAULT 'theoretical',

  line_subtotal_krw NUMERIC(15,0) NOT NULL,
  status sale_status NOT NULL DEFAULT 'reserved',

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sale_line_book_item ON sale_line(book, item_id);
```

### 6.2 매출-매입 라인 매칭 (`sale_line_allocation`)

매출이 어느 매입 라인에서 얼마나 차감했는지(개별법 specific identification).

```sql
CREATE TABLE sale_line_allocation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_line_id UUID NOT NULL REFERENCES sale_line(id) ON DELETE CASCADE,
  purchase_line_id UUID NOT NULL REFERENCES purchase_line(id),

  allocated_qty NUMERIC(15,3) NOT NULL,         -- 차감된 수량 (sale unit 기준)
  allocated_weight_kg NUMERIC(12,3) NOT NULL,   -- 차감된 무게
  cost_krw NUMERIC(15,0) NOT NULL,              -- 매출원가 (매입 단가 × 차감량)

  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,

  -- 동일 sale_line이 동일 purchase_line을 두 번 차감하면 합산 의도 불명 → 분리 row로 허용 (시간 차 출고)
  CONSTRAINT chk_alloc_positive CHECK (allocated_qty > 0 AND allocated_weight_kg > 0)
);
CREATE INDEX idx_alloc_sale ON sale_line_allocation(sale_line_id);
CREATE INDEX idx_alloc_purchase ON sale_line_allocation(purchase_line_id);
```

---

## 7. 책 간 이관 (`book_transfer`)

```sql
CREATE TABLE book_transfer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_type sale_subtype NOT NULL,         -- 'inter_book_transfer' | 'internal_reclass'
  source_book book_type NOT NULL,
  dest_book book_type NOT NULL,
  transferred_on DATE NOT NULL,

  -- 시가 근거 (BK↔SL은 NOT NULL, SL↔B는 선택)
  source_price_history_id UUID REFERENCES price_history(id),
  source_doc_url TEXT,                          -- 외부 견적서·계약서 등
  rationale_notes TEXT,

  -- 합계
  total_weight_kg NUMERIC(15,3) NOT NULL DEFAULT 0,
  total_value_krw NUMERIC(15,0) NOT NULL DEFAULT 0,

  paired_sale_id UUID REFERENCES sale(id),      -- 자동 생성된 매출 row 참조
  paired_purchase_id UUID REFERENCES purchase(id), -- 자동 생성된 매입 row 참조

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES user_profile(user_id),

  -- 이관 매트릭스 강제
  CONSTRAINT chk_transfer_pairs CHECK (
    -- BK↔SL: inter_book_transfer
    (transfer_type = 'inter_book_transfer'
       AND ((source_book = 'bk' AND dest_book = 'sl')
         OR (source_book = 'sl' AND dest_book = 'bk')))
    OR
    -- SL↔B: internal_reclass
    (transfer_type = 'internal_reclass'
       AND ((source_book = 'sl' AND dest_book = 'b')
         OR (source_book = 'b'  AND dest_book = 'sl')))
  ),
  -- BK↔SL 이관은 시가 근거 필수
  CONSTRAINT chk_inter_book_rationale CHECK (
    transfer_type <> 'inter_book_transfer'
    OR source_price_history_id IS NOT NULL
    OR source_doc_url IS NOT NULL
  )
);
CREATE INDEX idx_transfer_books ON book_transfer(source_book, dest_book, transferred_on DESC);
```

### 이관 워크플로우
1. 사용자가 "책 간 이관" 액션 → `book_transfer` row 생성
2. 시스템이 동시에 두 row 자동 생성:
   - `sale` row (source_book, subtype=transfer_type, transfer_id=ID) + `sale_line` + `sale_line_allocation`
   - `purchase` row (dest_book, subtype=transfer_type, transfer_id=ID) + `purchase_line`
3. `book_transfer.paired_sale_id / paired_purchase_id` 에 양쪽 ID 기록
4. audit_log 자동 기록

---

## 8. 재고 조정 (`inventory_adjustment`)

```sql
CREATE TABLE inventory_adjustment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  adj_type inventory_adjustment_type NOT NULL,
  adj_on DATE NOT NULL,

  source_purchase_line_id UUID REFERENCES purchase_line(id),  -- cut/split/loss/scrap
  -- 절단 결과로 생성된 새 purchase_line은 parent_purchase_line_id 컬럼으로 표현

  delta_qty NUMERIC(15,3),                       -- 양수: 증가, 음수: 감소
  delta_weight_kg NUMERIC(12,3),
  notes TEXT,
  attachments JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES user_profile(user_id)
);

-- 절단/분할 결과로 생성되는 자식 purchase_line 추적
ALTER TABLE purchase_line ADD COLUMN parent_purchase_line_id UUID REFERENCES purchase_line(id);
ALTER TABLE purchase_line ADD COLUMN created_by_adjustment_id UUID REFERENCES inventory_adjustment(id);
```

---

## 9. 위탁 재고 — 타사 재고가 우리 야적에 (`consignment_in`)

```sql
CREATE TABLE consignment_in (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partner(id),
  warehouse_id UUID NOT NULL REFERENCES warehouse(id),
  zone TEXT,
  item_id UUID REFERENCES item(id),
  spec_text TEXT,                                -- 비표준 품목일 때 자유 텍스트

  qty NUMERIC(15,3) NOT NULL,
  unit acquired_unit NOT NULL,
  weight_kg NUMERIC(12,3),

  in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  out_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in' CHECK (status IN ('in','out')),
  notes TEXT,
  attachments JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES user_profile(user_id)
);
```

> `consignment_in`은 우리 ledger 외부. 책 컬럼 없음. RLS는 책 무관 (전체 owner/manager만 접근).
> 우리 재고가 타사 야적에 있는 경우(consigned_out)는 `purchase_line.warehouse_id` 가 `kind='partner'`인 창고를 가리키므로 별도 테이블 불필요.

---

## 10. 통장 입출금 (`bank_transaction`)

```sql
CREATE TABLE bank_transaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES bank_account(id),
  book book_type NOT NULL,                       -- bank_account.book과 동일 (denormalized)
  txn_on DATE NOT NULL,

  amount_krw NUMERIC(15,0) NOT NULL,             -- 양수: 입금, 음수: 출금
  balance_after_krw NUMERIC(15,0),               -- 거래 후 잔액 (스냅샷)

  counterparty TEXT,                              -- 상대방 (자유텍스트)
  partner_id UUID REFERENCES partner(id),         -- 매핑되면 채움

  -- 연결된 거래 (하나만 채워짐)
  sale_id UUID REFERENCES sale(id),               -- 매출 수금
  purchase_id UUID REFERENCES purchase(id),       -- 매입 결제
  receipt_id UUID,                                -- 영수증
  category TEXT,                                  -- 미연결 거래의 카테고리 (인건비, 임차료 등)

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES user_profile(user_id)
);
CREATE INDEX idx_txn_account_date ON bank_transaction(bank_account_id, txn_on DESC);
CREATE INDEX idx_txn_book_date ON bank_transaction(book, txn_on DESC);
```

---

## 11. 미수금 (`receivable`) — 매출 기반 자동 계산 view

별도 테이블보다 view로 가는 게 정합성에 유리:

```sql
CREATE OR REPLACE VIEW vw_receivable AS
SELECT
  s.id AS sale_id,
  s.book,
  s.partner_id,
  s.doc_no,
  s.ordered_on,
  s.delivered_on,
  s.payment_due_on,
  s.settled_on,
  s.total_krw,
  COALESCE(SUM(bt.amount_krw) FILTER (WHERE bt.amount_krw > 0), 0) AS received_krw,
  s.total_krw - COALESCE(SUM(bt.amount_krw) FILTER (WHERE bt.amount_krw > 0), 0) AS outstanding_krw,

  -- 미수 등급
  CASE
    WHEN s.status = 'settled' THEN NULL
    WHEN s.payment_due_on IS NULL OR s.payment_due_on >= CURRENT_DATE THEN 'normal'::receivable_grade
    WHEN CURRENT_DATE - s.payment_due_on BETWEEN 1 AND 7 THEN 'short'::receivable_grade
    WHEN CURRENT_DATE - s.payment_due_on BETWEEN 8 AND 30 THEN 'mid'::receivable_grade
    ELSE 'long'::receivable_grade
  END AS grade,

  CURRENT_DATE - s.payment_due_on AS days_overdue

FROM sale s
LEFT JOIN bank_transaction bt ON bt.sale_id = s.id
WHERE s.deleted_at IS NULL AND s.status NOT IN ('cancelled')
GROUP BY s.id;
```

### 어음 (`promissory_note`)

```sql
CREATE TABLE promissory_note (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('received','issued')),
  partner_id UUID REFERENCES partner(id),

  issue_on DATE NOT NULL,
  maturity_on DATE NOT NULL,
  amount_krw NUMERIC(15,0) NOT NULL,
  note_no TEXT,

  -- 연결
  sale_id UUID REFERENCES sale(id),                -- 수취 어음일 때
  purchase_id UUID REFERENCES purchase(id),        -- 발행 어음일 때

  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','collected','dishonored','endorsed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 12. 영수증 (`receipt`)

```sql
CREATE TABLE receipt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  receipt_on DATE NOT NULL,
  category TEXT NOT NULL,                        -- '식대','연료비','자재','접대비' ...
  partner_id UUID REFERENCES partner(id),

  amount_krw NUMERIC(15,0) NOT NULL,
  vat_included BOOLEAN NOT NULL DEFAULT TRUE,
  tax_doc_type tax_doc_type NOT NULL DEFAULT 'simple_receipt',
  tax_doc_no TEXT,

  attachments JSONB,                              -- 사진/스캔 URL
  notes TEXT,

  pay_bank_account_id UUID REFERENCES bank_account(id),
  pay_method TEXT,                                -- 'card','cash','bank_transfer'

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES user_profile(user_id),

  CONSTRAINT chk_bk_receipt_documented CHECK (
    book <> 'bk' OR tax_doc_type IN ('tax_invoice_electronic','tax_invoice_paper','invoice','cash_receipt')
  )
);
```

---

## 13. 시세 (`price_history`, `price_curation`)

### 13.1 시세 이력

```sql
CREATE TABLE price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_item_id UUID NOT NULL REFERENCES market_item(id),
  recorded_on DATE NOT NULL,
  price_per_unit NUMERIC(15,2) NOT NULL,
  unit acquired_unit NOT NULL,
  price_type price_type NOT NULL DEFAULT 'spot',
  source price_source NOT NULL,
  source_label TEXT,
  source_url TEXT,
  recorded_by UUID REFERENCES user_profile(user_id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (market_item_id, recorded_on, source, price_type)
);
CREATE INDEX idx_price_history_item_date ON price_history(market_item_id, recorded_on DESC);
```

### 13.2 "오늘의 시세" 큐레이션 목록

```sql
CREATE TABLE price_curation (
  market_item_id UUID PRIMARY KEY REFERENCES market_item(id),
  display_order INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 13.3 매입가 자동 누적 트리거

```sql
CREATE OR REPLACE FUNCTION price_history_autofill_from_purchase()
RETURNS TRIGGER AS $$
DECLARE
  v_market_item UUID;
  v_price_per_kg NUMERIC;
BEGIN
  SELECT i.market_item_id INTO v_market_item
    FROM item i WHERE i.id = NEW.item_id;

  IF v_market_item IS NULL THEN RETURN NEW; END IF;

  -- 단가를 kg 기준으로 환산
  IF NEW.acquired_unit = 'kg' THEN
    v_price_per_kg := NEW.unit_price_krw;
  ELSIF NEW.acquired_unit = 'ton' THEN
    v_price_per_kg := NEW.unit_price_krw / 1000;
  ELSIF NEW.theoretical_weight_kg IS NOT NULL AND NEW.acquired_qty > 0 THEN
    v_price_per_kg := (NEW.unit_price_krw * NEW.acquired_qty) / NEW.theoretical_weight_kg;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO price_history (market_item_id, recorded_on, price_per_unit, unit, price_type, source, source_label, recorded_by)
  VALUES (
    v_market_item,
    (SELECT delivered_on FROM purchase WHERE id = NEW.purchase_id),
    v_price_per_kg, 'kg', 'spot', 'purchase_derived', NEW.purchase_id::TEXT, NEW.created_by
  )
  ON CONFLICT (market_item_id, recorded_on, source, price_type) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_price_autofill_from_purchase
AFTER INSERT ON purchase_line
FOR EACH ROW EXECUTE FUNCTION price_history_autofill_from_purchase();
```

---

## 14. 운영 — 영업·명함·정기업무·아이디어

```sql
-- 영업 콜드 prospecting
CREATE TABLE sales_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contacted_on DATE NOT NULL,
  partner_id UUID REFERENCES partner(id),        -- 등록 거래처면 매핑
  prospect_name TEXT,                             -- 미등록 잠재 거래처 자유 텍스트
  contact_person TEXT,
  channel TEXT,                                   -- 'phone','visit','email','sms'
  result TEXT,
  follow_up_on DATE,
  notes TEXT,
  created_by UUID REFERENCES user_profile(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 명함
CREATE TABLE business_card (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_on DATE,
  partner_id UUID REFERENCES partner(id),         -- 등록되면 매핑
  name TEXT NOT NULL,
  title TEXT,
  company TEXT,
  phone TEXT, email TEXT, address TEXT,
  image_url TEXT,                                 -- 명함 사진
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 정기업무 (체크리스트성)
CREATE TABLE recurring_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  cadence TEXT NOT NULL,                          -- 'daily','weekly','monthly','yearly','adhoc'
  due_rule TEXT,                                  -- '매월 10일' 등 사람용 설명
  owner UUID REFERENCES user_profile(user_id),
  related_book book_type,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE recurring_task_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES recurring_task(id),
  done_on DATE NOT NULL,
  done_by UUID REFERENCES user_profile(user_id),
  notes TEXT
);

-- 개선 아이디어
CREATE TABLE improvement_idea (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,                                  -- 'system','process','sales','operations'
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT,
  proposed_by UUID REFERENCES user_profile(user_id),
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  notes TEXT
);
```

---

## 15. Audit log

```sql
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id UUID NOT NULL,
  book book_type,                                 -- 거래성 테이블만 채움
  action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  before JSONB,
  after JSONB,
  changed_columns TEXT[],
  actor UUID REFERENCES user_profile(user_id),
  ip INET,
  ua TEXT,
  sensitive BOOLEAN NOT NULL DEFAULT FALSE,       -- B계좌 관련은 TRUE
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_table_row ON audit_log(table_name, row_id);
CREATE INDEX idx_audit_book_at ON audit_log(book, at DESC);
CREATE INDEX idx_audit_sensitive ON audit_log(sensitive, at DESC) WHERE sensitive = TRUE;

-- 트리거 템플릿
CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
DECLARE
  v_book book_type;
  v_row_id UUID;
  v_before JSONB;
  v_after JSONB;
  v_changed TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_after  := to_jsonb(NEW); v_row_id := (NEW).id;
    v_book   := (v_after ->> 'book')::book_type;
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD); v_after := to_jsonb(NEW); v_row_id := (NEW).id;
    v_book   := (v_after ->> 'book')::book_type;
    SELECT array_agg(key) INTO v_changed
      FROM jsonb_each(v_after)
      WHERE v_before->>key IS DISTINCT FROM v_after->>key;
  ELSE
    v_before := to_jsonb(OLD); v_row_id := (OLD).id;
    v_book   := (v_before ->> 'book')::book_type;
  END IF;

  INSERT INTO audit_log (table_name, row_id, book, action, before, after, changed_columns, actor, sensitive)
  VALUES (TG_TABLE_NAME, v_row_id, v_book, TG_OP, v_before, v_after, v_changed, auth.uid(), v_book = 'b');

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 거래성 테이블에 적용
CREATE TRIGGER trg_audit_purchase AFTER INSERT OR UPDATE OR DELETE ON purchase FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_purchase_line AFTER INSERT OR UPDATE OR DELETE ON purchase_line FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_sale AFTER INSERT OR UPDATE OR DELETE ON sale FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_sale_line AFTER INSERT OR UPDATE OR DELETE ON sale_line FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_book_transfer AFTER INSERT OR UPDATE OR DELETE ON book_transfer FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_bank_txn AFTER INSERT OR UPDATE OR DELETE ON bank_transaction FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_inventory_adj AFTER INSERT OR UPDATE OR DELETE ON inventory_adjustment FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_receipt AFTER INSERT OR UPDATE OR DELETE ON receipt FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

---

## 16. View / Materialized View

### 16.1 재고 (`vw_inventory`)

```sql
CREATE OR REPLACE VIEW vw_inventory AS
SELECT
  pl.id AS purchase_line_id,
  pl.book,
  pl.warehouse_id,
  pl.zone,
  pl.item_id,
  pl.acquired_unit,
  pl.acquired_qty,
  pl.acquired_qty - COALESCE(SUM(a.allocated_qty), 0) AS remaining_qty,
  pl.theoretical_weight_kg,
  pl.actual_weight_kg,
  COALESCE(pl.actual_weight_kg, pl.theoretical_weight_kg, 0)
    - COALESCE(SUM(a.allocated_weight_kg), 0) AS remaining_weight_kg,
  pl.unit_price_krw,
  pl.grade,
  pl.length_mm,
  pl.bars_count,
  pl.status,
  pl.created_at AS acquired_at
FROM purchase_line pl
LEFT JOIN sale_line_allocation a ON a.purchase_line_id = pl.id
WHERE pl.deleted_at IS NULL
  AND pl.status NOT IN ('transferred_out','scrapped')
GROUP BY pl.id
HAVING pl.acquired_qty - COALESCE(SUM(a.allocated_qty), 0) > 0;
```

### 16.2 책별·품목별 재고 요약

```sql
CREATE OR REPLACE VIEW vw_inventory_by_book_item AS
SELECT
  book, item_id,
  SUM(remaining_qty) AS total_qty,
  SUM(remaining_weight_kg) AS total_weight_kg,
  COUNT(*) AS line_count
FROM vw_inventory
GROUP BY book, item_id;
```

### 16.3 오늘의 시가 (`vw_today_market_price`)

```sql
CREATE OR REPLACE VIEW vw_today_market_price AS
WITH ranked AS (
  SELECT
    ph.*,
    ROW_NUMBER() OVER (
      PARTITION BY market_item_id, recorded_on
      ORDER BY CASE source WHEN 'manual' THEN 1 WHEN 'external' THEN 2 ELSE 3 END
    ) AS rnk
  FROM price_history ph
  WHERE recorded_on >= CURRENT_DATE - INTERVAL '90 days'
)
SELECT DISTINCT ON (market_item_id)
  market_item_id, recorded_on, price_per_unit, unit, price_type, source
FROM ranked
WHERE rnk = 1
ORDER BY market_item_id, recorded_on DESC;
```

### 16.4 재고 시가 평가

```sql
CREATE OR REPLACE VIEW vw_inventory_valuation AS
SELECT
  inv.book,
  inv.item_id,
  inv.total_weight_kg,
  tp.price_per_unit AS market_price_per_kg,
  inv.total_weight_kg * tp.price_per_unit AS valuation_krw
FROM vw_inventory_by_book_item inv
JOIN item i ON i.id = inv.item_id
LEFT JOIN vw_today_market_price tp ON tp.market_item_id = i.market_item_id;
```

### 16.5 책별 P&L (월별)

```sql
CREATE OR REPLACE VIEW vw_book_monthly_pnl AS
SELECT
  s.book,
  DATE_TRUNC('month', s.ordered_on)::DATE AS month,
  SUM(s.subtotal_krw)                       AS revenue_krw,
  SUM(alloc.cost_krw)                       AS cogs_krw,
  SUM(s.subtotal_krw) - SUM(alloc.cost_krw) AS gross_profit_krw
FROM sale s
JOIN sale_line sl ON sl.sale_id = s.id
JOIN sale_line_allocation alloc ON alloc.sale_line_id = sl.id
WHERE s.deleted_at IS NULL AND s.status NOT IN ('cancelled')
GROUP BY s.book, DATE_TRUNC('month', s.ordered_on);
```

---

## 17. RLS 정책

```sql
ALTER TABLE purchase ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_transfer ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustment ENABLE ROW LEVEL SECURITY;
ALTER TABLE promissory_note ENABLE ROW LEVEL SECURITY;
-- 마스터/공유 테이블은 SELECT는 인증된 모든 사용자, WRITE는 owner/manager

-- 패턴: 책 단위 RLS
CREATE POLICY purchase_read ON purchase FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY purchase_write ON purchase FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY purchase_update ON purchase FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY purchase_delete ON purchase FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- 동일 패턴을 sale, purchase_line, sale_line, bank_*, book_transfer 등에 반복 적용
-- book_transfer는 source_book과 dest_book 모두 권한 있어야:
CREATE POLICY transfer_write ON book_transfer FOR INSERT WITH CHECK (
  current_user_has_book_role(source_book, 'manager')
  AND current_user_has_book_role(dest_book, 'manager')
);
```

---

## 18. 인덱스 전략 요약

- 거래성 테이블: `(book, ordered_on DESC)` 복합 인덱스 — 책별 시계열 조회 빈번
- 외래키: 모든 `partner_id`, `item_id`, `bank_account_id`, `warehouse_id` 에 인덱스
- audit_log: `(table_name, row_id)`, `(book, at)`, partial `sensitive=true`
- price_history: `(market_item_id, recorded_on DESC)`
- soft delete: `WHERE deleted_at IS NULL` partial 인덱스

---

## 19. 마이그레이션 — 5월 CSV → seed

`docs/reference-data/*.csv` 의 워크북 데이터를 v1 스키마로 옮기는 매핑.

| 원본 시트 | 대상 테이블 | 책 매핑 룰 |
|---|---|---|
| `5.거래처.csv` | `partner` + `partner_alias` | 책 무관 (공유) |
| `1.매출.csv` | `sale` + `sale_line` | 통장 코드(`법인A`/`사업자A`/`B계좌`) → `bk`/`sl`/`b`. `is_documented`: 자료 컬럼 있으면 그대로, 없으면 책 기본값 |
| `2.매입.csv` | `purchase` + `purchase_line` | 동일 |
| `3.재고.csv` | (seed 검증용) | `vw_inventory`로 자동 계산. CSV 값은 검증에만 |
| `4.영수증.csv` | `receipt` | 결제 통장 코드로 책 결정 |
| `6.통장.csv` | `bank_account` + `bank_transaction` | 통장 코드 그대로 책 |
| `7.정기업무.csv` | `recurring_task` (+ `recurring_task_log`) | 책 컬럼은 row별 결정 |
| `8.미수관리.csv` | (검증용) | `vw_receivable` 으로 자동 계산 |
| `9.영업내역.csv` | `sales_log` | 책 무관 |
| `10.명함.csv` | `business_card` | 책 무관 |
| `0.개선아이디어.csv` | `improvement_idea` | 책 무관 |

### 시드 절차
1. enums + master tables (`partner`, `item`, `rebar_*`, `market_item`, `warehouse`, `bank_account`)
2. `partner_alias` 정합성 검증 (5.거래처와 1.매출/2.매입의 거래처명 충돌 해결)
3. `bank_transaction` (통장 흐름)
4. `purchase` + `purchase_line` (책 컬럼 부여)
5. `sale` + `sale_line` + `sale_line_allocation` (FIFO 자동 할당)
6. `receipt`, `recurring_task`, `sales_log`, `business_card`, `improvement_idea`
7. `price_history` (매입라인 트리거로 자동 누적되거나 별도 seed)

---

## 20. 변경 이력

- **v1.0 (2026-05-12)**: 초안. 도메인 룰 v1 확정본 기반 전체 스키마. 마이그레이션 SQL은 별도 작성.

## 21. 미해결 / 다음 회차 검토

- `transfer_id` 컬럼이 `purchase`/`sale` 양쪽에 있는데 FK 순환 참조 → 마이그레이션 단계에서 DEFERRABLE 제약으로 풀거나 `book_transfer`를 단방향 FK로만 (sale/purchase → book_transfer) 운영
- `consignment_in` 의 책별 RLS — 현재는 책 무관이지만 owner 전용으로 제한할지
- `audit_log` 의 보존 기간/아카이브 정책 (5년? 영구?)
- 견적서(`quotation`) 테이블 v1 포함 여부 — 매출 reserved 상태로 대체 가능
- 세금계산서 실제 발행 연동 (이세로/스마트빌 등 API) — v2
