# 시스템 DB 스키마 v1.1

> Supabase(PostgreSQL 15+) 기준. `docs/시스템_도메인_룰_v1.md` 확정본 + `docs/철근_제품마스터.md` 기반.
> v1.0 자체 리뷰 결과 반영(Critical 6개 + 도메인 결정 6개 + 보완 8개). 본 문서가 v1 확정 청사진.

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
9. **명명**: snake_case + 한글 주석

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

-- 부가세 유형 (자료별 vat_rate 의미 명확화)
CREATE TYPE vat_type AS ENUM (
  'standard_10',     -- 10% 일반
  'zero_rated',      -- 영세율 (수출 등, 자료 발행 + vat=0)
  'exempt',          -- 면세 (계산서)
  'non_taxable'      -- 과세대상 아님
);

-- 거래 단위
CREATE TYPE acquired_unit AS ENUM ('ton', 'kg', 'ea', 'piece', 'bundle', 'set');

-- 단가 기준 (이론/실)
CREATE TYPE price_basis AS ENUM ('theoretical', 'actual');

-- 매입 상태머신
CREATE TYPE purchase_status AS ENUM (
  'ordered',           -- 발주, 미입고
  'in_stock',          -- 입고, 재고 보유
  'partial_out',       -- 일부 출고됨
  'depleted',          -- 전량 출고
  'transferred_out',   -- 책 간 이관으로 빠짐
  'scrapped'           -- 폐기
);

-- 매출 상태머신
CREATE TYPE sale_status AS ENUM (
  'reserved',          -- 매출 예약·견적 (별도 quotation 테이블 없음 — 여기서 흡수)
  'confirmed',         -- 매출 확정
  'delivered',         -- 납품 완료
  'settled',           -- 수금 완료
  'overdue',           -- 수금 연체
  'cancelled'          -- 취소
);

-- 외부 vs 책 간 거래 구분
CREATE TYPE sale_subtype AS ENUM (
  'external',
  'inter_book_transfer',
  'internal_reclass'
);
CREATE TYPE purchase_subtype AS ENUM (
  'external',
  'inter_book_transfer',
  'internal_reclass'
);

-- 책 간 이관 헤더 전용 (external은 들어갈 수 없게 분리)
CREATE TYPE book_transfer_type AS ENUM ('inter_book_transfer', 'internal_reclass');

-- 재고 조정 — transform(라인 재구성)과 delta(증감)로 의미 구분
CREATE TYPE inventory_adjustment_kind AS ENUM ('transform', 'delta');
CREATE TYPE inventory_adjustment_reason AS ENUM (
  -- transform
  'cut',          -- 절단/가공 (parent → children)
  'split',        -- 분할
  'merge',        -- 병합
  -- delta
  'stocktake',    -- 재고실사 차이 조정
  'loss',         -- 감모/유실
  'scrap',        -- 폐기
  'return_in',    -- 반품 입고
  'return_out'    -- 반품 출고
);

-- 통장 종류
CREATE TYPE bank_account_kind AS ENUM ('corporate','personal','b_hidden');

-- 미수 등급
CREATE TYPE receivable_grade AS ENUM ('normal','short','mid','long');

-- 시세 종류
CREATE TYPE price_type AS ENUM ('wholesale','retail','scrap','spot');
CREATE TYPE price_source AS ENUM ('manual','external','purchase_derived');

-- 창고 종류
CREATE TYPE warehouse_kind AS ENUM ('owned','partner');

-- 사용자 역할
CREATE TYPE book_role AS ENUM ('owner','manager','staff','accountant','viewer');

-- 어음 / 첨부 등 보조
CREATE TYPE promissory_note_direction AS ENUM ('received','issued');
CREATE TYPE promissory_note_status AS ENUM ('open','collected','dishonored','endorsed');
```

---

## 2. 사용자 / 권한

```sql
CREATE TABLE user_profile (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  phone TEXT,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
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

-- 시드/시스템 작업용 가상 actor (audit_log의 actor가 NULL일 때 대체 표시용)
INSERT INTO user_profile (user_id, display_name, is_owner)
VALUES ('00000000-0000-0000-0000-000000000001', '시스템(seed/job)', FALSE);

-- 헬퍼: 현재 유저가 특정 책에 최소 권한 이상 보유 여부
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
| 직원 | — | staff | — |
| 회계사 | accountant | accountant | — |

---

## 3. 마스터 — 공유

### 3.1 거래처 (`partner`)

```sql
CREATE TABLE partner (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  business_no TEXT,
  representative TEXT,
  phone TEXT, fax TEXT,
  address TEXT,
  industry TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id),
  updated_by UUID REFERENCES user_profile(user_id)
);

CREATE TABLE partner_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  alias TEXT NOT NULL UNIQUE
);

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
CREATE INDEX idx_partner_name_trgm ON partner USING gin (name gin_trgm_ops);  -- 검색용 (pg_trgm 확장 필요)
```

### 3.2 시세 분류 (`market_item`)

```sql
CREATE TABLE market_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  label_ko TEXT NOT NULL,
  category TEXT NOT NULL,
  default_unit acquired_unit NOT NULL DEFAULT 'kg',
  display_order INT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.3 철근 마스터 (`rebar_spec`, `rebar_grade`)

`docs/철근_제품마스터.md` 시드 SQL 그대로 (D10~D51, SD300~SD700/W/S 변종).

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
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  market_item_id UUID REFERENCES market_item(id),

  rebar_spec_code TEXT REFERENCES rebar_spec(spec_code),
  rebar_grade_code TEXT REFERENCES rebar_grade(grade_code),
  length_m NUMERIC(5,2),

  spec_text TEXT,
  weight_per_unit_kg NUMERIC(10,3),

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT chk_rebar_consistency CHECK (
    (category = 'rebar' AND rebar_spec_code IS NOT NULL)
    OR (category <> 'rebar' AND rebar_spec_code IS NULL)
  )
);
CREATE INDEX idx_item_category ON item(category) WHERE deleted_at IS NULL;
```

### 3.5 창고 / 야적장 (`warehouse`, `warehouse_zone`)

```sql
CREATE TABLE warehouse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  kind warehouse_kind NOT NULL DEFAULT 'owned',
  partner_id UUID REFERENCES partner(id),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_partner_warehouse CHECK (
    (kind = 'partner' AND partner_id IS NOT NULL)
    OR (kind = 'owned' AND partner_id IS NULL)
  )
);

CREATE TABLE warehouse_zone (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE,
  zone_code TEXT NOT NULL,
  preferred_book book_type,
  display_order INT,
  notes TEXT,
  UNIQUE (warehouse_id, zone_code)
);
```

> v1.1 변경: `purchase_line.zone` 자유 텍스트 → `warehouse_zone_id` FK로 강제 (zone 마스터 선등록 필수). 시드 단계에서 5월 데이터의 zone을 모두 마스터에 등록 후 import.

---

## 4. 마스터 — 책 종속

### 4.1 통장 (`bank_account`)

```sql
CREATE TABLE bank_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT,
  account_holder TEXT,
  kind bank_account_kind NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE (book, code),

  CONSTRAINT chk_bank_kind_book CHECK (
    (book = 'bk' AND kind = 'corporate')
    OR (book = 'sl' AND kind = 'personal')
    OR (book = 'b'  AND kind = 'b_hidden')
  )
);
```

---

## 5. 거래성 — 매입

### 5.1 `purchase` (헤더)

```sql
CREATE TABLE purchase (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  doc_no TEXT UNIQUE NOT NULL,
  partner_id UUID NOT NULL REFERENCES partner(id),

  purchase_subtype purchase_subtype NOT NULL DEFAULT 'external',
  transfer_id UUID,  -- book_transfer.id 단방향 참조 (v1.1: 순환 FK 제거)

  ordered_on DATE NOT NULL,
  delivered_on DATE,

  is_documented BOOLEAN NOT NULL,
  tax_doc_type tax_doc_type NOT NULL DEFAULT 'tax_invoice_electronic',
  tax_doc_no TEXT,
  vat_type vat_type NOT NULL DEFAULT 'standard_10',
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,

  subtotal_krw NUMERIC(15,0) NOT NULL DEFAULT 0,
  vat_krw NUMERIC(15,0) NOT NULL DEFAULT 0,
  total_krw NUMERIC(15,0) NOT NULL DEFAULT 0,

  payment_due_on DATE,
  paid_on DATE,
  pay_bank_account_id UUID REFERENCES bank_account(id),

  status purchase_status NOT NULL DEFAULT 'ordered',
  notes TEXT,
  attachments JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id),
  updated_by UUID REFERENCES user_profile(user_id),

  CONSTRAINT chk_bk_documented CHECK (book <> 'bk' OR is_documented = TRUE),
  CONSTRAINT chk_b_undocumented CHECK (book <> 'b' OR (is_documented = FALSE AND tax_doc_type = 'none')),
  CONSTRAINT chk_transfer_id_when_subtype CHECK (
    (purchase_subtype = 'external' AND transfer_id IS NULL)
    OR (purchase_subtype <> 'external' AND transfer_id IS NOT NULL)
  ),
  CONSTRAINT chk_vat_type_rate CHECK (
    (vat_type = 'standard_10' AND vat_rate = 10.00)
    OR (vat_type IN ('zero_rated','exempt','non_taxable') AND vat_rate = 0)
  )
);
CREATE INDEX idx_purchase_book_date ON purchase(book, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_partner_date ON purchase(partner_id, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_transfer ON purchase(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX idx_purchase_unpaid ON purchase(book, payment_due_on)
  WHERE deleted_at IS NULL AND paid_on IS NULL;
```

### 5.2 `purchase_line` (라인 = piece/lot 역할)

```sql
CREATE TABLE purchase_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchase(id) ON DELETE CASCADE,
  book book_type NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES warehouse(id),
  warehouse_zone_id UUID REFERENCES warehouse_zone(id),  -- v1.1: FK 강제
  item_id UUID NOT NULL REFERENCES item(id),

  acquired_unit acquired_unit NOT NULL,
  acquired_qty NUMERIC(15,3) NOT NULL,
  unit_price_krw NUMERIC(15,2) NOT NULL,

  bars_count INT,
  length_mm INT,
  grade TEXT,

  theoretical_weight_kg NUMERIC(12,3),
  actual_weight_kg NUMERIC(12,3),
  invoiced_weight_kg NUMERIC(12,3),
  price_basis price_basis NOT NULL DEFAULT 'theoretical',

  line_subtotal_krw NUMERIC(15,0) NOT NULL,
  status purchase_status NOT NULL DEFAULT 'in_stock',

  parent_purchase_line_id UUID REFERENCES purchase_line(id),  -- cut/split의 부모
  created_by_adjustment_id UUID,                              -- inventory_adjustment.id (자식 라인이면)

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id),
  updated_by UUID REFERENCES user_profile(user_id),

  -- kg 단위 매입은 actual_weight_kg 필수
  CONSTRAINT chk_kg_unit_actual_required CHECK (
    acquired_unit <> 'kg' OR actual_weight_kg IS NOT NULL
  ),
  -- 가닥 단위는 bars_count 필수
  CONSTRAINT chk_bars_count_required CHECK (
    acquired_unit NOT IN ('ea','piece','bundle') OR bars_count IS NOT NULL
  )
);
CREATE INDEX idx_purchase_line_book_item ON purchase_line(book, item_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_line_warehouse ON purchase_line(warehouse_id, warehouse_zone_id);
CREATE INDEX idx_purchase_line_status ON purchase_line(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_line_parent ON purchase_line(parent_purchase_line_id) WHERE parent_purchase_line_id IS NOT NULL;
```

---

## 6. 거래성 — 매출

### 6.1 `sale` (헤더)

```sql
CREATE TABLE sale (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  doc_no TEXT UNIQUE NOT NULL,
  partner_id UUID NOT NULL REFERENCES partner(id),
  site_name TEXT,

  sale_subtype sale_subtype NOT NULL DEFAULT 'external',
  transfer_id UUID,  -- book_transfer.id 단방향 참조

  ordered_on DATE NOT NULL,
  delivered_on DATE,

  is_documented BOOLEAN NOT NULL,
  tax_doc_type tax_doc_type NOT NULL DEFAULT 'tax_invoice_electronic',
  tax_doc_no TEXT,
  vat_type vat_type NOT NULL DEFAULT 'standard_10',
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,

  subtotal_krw NUMERIC(15,0) NOT NULL DEFAULT 0,
  vat_krw NUMERIC(15,0) NOT NULL DEFAULT 0,
  total_krw NUMERIC(15,0) NOT NULL DEFAULT 0,

  payment_due_on DATE,
  settled_on DATE,
  receive_bank_account_id UUID REFERENCES bank_account(id),

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
  ),
  CONSTRAINT chk_sale_vat_type_rate CHECK (
    (vat_type = 'standard_10' AND vat_rate = 10.00)
    OR (vat_type IN ('zero_rated','exempt','non_taxable') AND vat_rate = 0)
  )
);
CREATE INDEX idx_sale_book_date ON sale(book, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_sale_partner_date ON sale(partner_id, ordered_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_sale_transfer ON sale(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX idx_sale_unsettled ON sale(book, payment_due_on)
  WHERE deleted_at IS NULL AND settled_on IS NULL AND status NOT IN ('cancelled');
```

### 6.2 `sale_line`

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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_sale_line_book_item ON sale_line(book, item_id) WHERE deleted_at IS NULL;
```

### 6.3 `sale_line_allocation` (매출↔매입 매칭, 개별법)

**룰** (v1.1 명문화):
- 매칭의 기준은 **`allocated_weight_kg`(무게)** — 매입·매출 단위가 달라도 무게로 정합
- `allocated_qty`는 표시·차감 추적용 (매출 단위 기준)
- 한 sale_line이 여러 purchase_line을 차감하면 row 여러 개
- 출고 시 default 차감 알고리즘은 **FIFO**(by `purchase_line.created_at`), 사용자가 UI에서 override 가능

```sql
CREATE TABLE sale_line_allocation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_line_id UUID NOT NULL REFERENCES sale_line(id) ON DELETE CASCADE,
  purchase_line_id UUID NOT NULL REFERENCES purchase_line(id),

  allocated_qty NUMERIC(15,3) NOT NULL,
  allocated_weight_kg NUMERIC(12,3) NOT NULL,
  cost_krw NUMERIC(15,0) NOT NULL,         -- 매출원가 = 매입단가 환산 × 차감무게

  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,

  CONSTRAINT chk_alloc_positive CHECK (allocated_weight_kg > 0)
);
CREATE INDEX idx_alloc_sale ON sale_line_allocation(sale_line_id);
CREATE INDEX idx_alloc_purchase ON sale_line_allocation(purchase_line_id);
```

---

## 7. 책 간 이관 (`book_transfer`)

> v1.1 변경: `paired_sale_id`/`paired_purchase_id` 제거 (순환 FK 회피). 짝 조회는 `sale.transfer_id = book_transfer.id` / `purchase.transfer_id = book_transfer.id` 단방향.

```sql
CREATE TABLE book_transfer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_type book_transfer_type NOT NULL,   -- 전용 enum (v1.1)
  source_book book_type NOT NULL,
  dest_book book_type NOT NULL,
  transferred_on DATE NOT NULL,

  source_price_history_id UUID REFERENCES price_history(id),
  source_doc_url TEXT,
  rationale_notes TEXT,

  total_weight_kg NUMERIC(15,3) NOT NULL DEFAULT 0,
  total_value_krw NUMERIC(15,0) NOT NULL DEFAULT 0,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id),
  updated_by UUID REFERENCES user_profile(user_id),

  CONSTRAINT chk_transfer_pairs CHECK (
    (transfer_type = 'inter_book_transfer'
       AND ((source_book = 'bk' AND dest_book = 'sl')
         OR (source_book = 'sl' AND dest_book = 'bk')))
    OR
    (transfer_type = 'internal_reclass'
       AND ((source_book = 'sl' AND dest_book = 'b')
         OR (source_book = 'b'  AND dest_book = 'sl')))
  ),
  CONSTRAINT chk_inter_book_rationale CHECK (
    transfer_type <> 'inter_book_transfer'
    OR source_price_history_id IS NOT NULL
    OR source_doc_url IS NOT NULL
  )
);
CREATE INDEX idx_transfer_books ON book_transfer(source_book, dest_book, transferred_on DESC);
```

### 이관 워크플로우
1. `book_transfer` 헤더 row 생성 (시가 근거 첨부 — BK↔SL은 필수)
2. 시스템이 동시에 두 row 자동 생성:
   - `sale` (source_book, subtype, transfer_id) + `sale_line` + `sale_line_allocation`
   - `purchase` (dest_book, subtype, transfer_id) + `purchase_line`
3. audit_log 자동 기록 (양쪽 책 모두 sensitive 표시 가능)

---

## 8. 재고 조정 (`inventory_adjustment`)

> v1.1: `kind`로 transform vs delta 의미 명확화. transform은 라인 재구성(cut/split/merge), delta는 증감(stocktake/loss/scrap/return).

```sql
CREATE TABLE inventory_adjustment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  kind inventory_adjustment_kind NOT NULL,
  reason inventory_adjustment_reason NOT NULL,
  adj_on DATE NOT NULL,

  -- transform 계열 (cut/split/merge): 부모/자식 라인은 purchase_line의 parent_purchase_line_id로 추적
  source_purchase_line_id UUID REFERENCES purchase_line(id),

  -- delta 계열 (stocktake/loss/scrap/return_*): 단순 증감
  delta_qty NUMERIC(15,3),
  delta_weight_kg NUMERIC(12,3),

  notes TEXT,
  attachments JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id),

  CONSTRAINT chk_kind_reason CHECK (
    (kind = 'transform' AND reason IN ('cut','split','merge'))
    OR
    (kind = 'delta' AND reason IN ('stocktake','loss','scrap','return_in','return_out'))
  ),
  CONSTRAINT chk_transform_source CHECK (
    kind <> 'transform' OR source_purchase_line_id IS NOT NULL
  ),
  CONSTRAINT chk_delta_amount CHECK (
    kind <> 'delta' OR delta_weight_kg IS NOT NULL
  )
);
CREATE INDEX idx_inv_adj_book_date ON inventory_adjustment(book, adj_on DESC) WHERE deleted_at IS NULL;
```

---

## 9. 위탁 입고 (`consignment_in`) — 타사 재고가 우리 야적에

```sql
CREATE TABLE consignment_in (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partner(id),
  warehouse_id UUID NOT NULL REFERENCES warehouse(id),
  warehouse_zone_id UUID REFERENCES warehouse_zone(id),
  item_id UUID REFERENCES item(id),
  spec_text TEXT,

  qty NUMERIC(15,3) NOT NULL,
  unit acquired_unit NOT NULL,
  weight_kg NUMERIC(12,3),

  in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  out_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in' CHECK (status IN ('in','out')),
  notes TEXT,
  attachments JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id)
);
CREATE INDEX idx_consignment_in_warehouse ON consignment_in(warehouse_id, status);
```

> 우리 ledger 외부 (책 컬럼 없음). RLS는 owner/manager 전용.
> 우리 재고가 타사 야적에 있는 경우(consigned_out)는 `purchase_line.warehouse_id` 가 `kind='partner'` 인 창고를 가리키므로 별도 테이블 불필요.

---

## 10. 통장 입출금 (`bank_transaction`)

```sql
CREATE TABLE bank_transaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES bank_account(id),
  book book_type NOT NULL,
  txn_on DATE NOT NULL,

  amount_krw NUMERIC(15,0) NOT NULL,                -- 양수: 입금, 음수: 출금
  balance_after_krw NUMERIC(15,0),

  counterparty TEXT,
  partner_id UUID REFERENCES partner(id),

  sale_id UUID REFERENCES sale(id),
  purchase_id UUID REFERENCES purchase(id),
  receipt_id UUID,
  category TEXT,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id)
);
CREATE INDEX idx_txn_account_date ON bank_transaction(bank_account_id, txn_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_txn_book_date ON bank_transaction(book, txn_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_txn_sale ON bank_transaction(sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX idx_txn_purchase ON bank_transaction(purchase_id) WHERE purchase_id IS NOT NULL;
```

---

## 11. 미수금 / 어음

### 11.1 `vw_receivable`

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

  CASE
    WHEN s.status = 'settled' THEN NULL
    WHEN s.payment_due_on IS NULL OR s.payment_due_on >= CURRENT_DATE THEN 'normal'::receivable_grade
    WHEN CURRENT_DATE - s.payment_due_on BETWEEN 1 AND 7 THEN 'short'::receivable_grade
    WHEN CURRENT_DATE - s.payment_due_on BETWEEN 8 AND 30 THEN 'mid'::receivable_grade
    ELSE 'long'::receivable_grade
  END AS grade,

  CURRENT_DATE - s.payment_due_on AS days_overdue
FROM sale s
LEFT JOIN bank_transaction bt
  ON bt.sale_id = s.id AND bt.deleted_at IS NULL
WHERE s.deleted_at IS NULL AND s.status NOT IN ('cancelled')
GROUP BY s.id;
```

### 11.2 `promissory_note`

```sql
CREATE TABLE promissory_note (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  direction promissory_note_direction NOT NULL,
  partner_id UUID REFERENCES partner(id),

  issue_on DATE NOT NULL,
  maturity_on DATE NOT NULL,
  amount_krw NUMERIC(15,0) NOT NULL,
  note_no TEXT,

  sale_id UUID REFERENCES sale(id),
  purchase_id UUID REFERENCES purchase(id),

  status promissory_note_status NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_note_maturity ON promissory_note(maturity_on, status) WHERE deleted_at IS NULL AND status = 'open';
CREATE INDEX idx_note_book ON promissory_note(book, direction, maturity_on);
```

---

## 12. 외상매입금 (`vw_payable`) — v1.1 신규

```sql
CREATE OR REPLACE VIEW vw_payable AS
SELECT
  p.id AS purchase_id,
  p.book,
  p.partner_id,
  p.doc_no,
  p.ordered_on,
  p.delivered_on,
  p.payment_due_on,
  p.paid_on,
  p.total_krw,
  -- 매입 결제는 통장 출금 (음수)
  COALESCE(SUM(-bt.amount_krw) FILTER (WHERE bt.amount_krw < 0), 0) AS paid_krw,
  p.total_krw - COALESCE(SUM(-bt.amount_krw) FILTER (WHERE bt.amount_krw < 0), 0) AS outstanding_krw,

  CASE
    WHEN p.paid_on IS NOT NULL THEN NULL
    WHEN p.payment_due_on IS NULL OR p.payment_due_on >= CURRENT_DATE THEN 'normal'::receivable_grade
    WHEN CURRENT_DATE - p.payment_due_on BETWEEN 1 AND 7 THEN 'short'::receivable_grade
    WHEN CURRENT_DATE - p.payment_due_on BETWEEN 8 AND 30 THEN 'mid'::receivable_grade
    ELSE 'long'::receivable_grade
  END AS grade,

  CURRENT_DATE - p.payment_due_on AS days_overdue
FROM purchase p
LEFT JOIN bank_transaction bt
  ON bt.purchase_id = p.id AND bt.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id;
```

---

## 13. 영수증 (`receipt`)

```sql
CREATE TABLE receipt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book book_type NOT NULL,
  receipt_on DATE NOT NULL,
  category TEXT NOT NULL,                    -- '식대','연료비','자재','접대비','급여','임차료' ...
  partner_id UUID REFERENCES partner(id),

  amount_krw NUMERIC(15,0) NOT NULL,
  vat_included BOOLEAN NOT NULL DEFAULT TRUE,
  tax_doc_type tax_doc_type NOT NULL DEFAULT 'simple_receipt',
  tax_doc_no TEXT,

  attachments JSONB,
  notes TEXT,

  pay_bank_account_id UUID REFERENCES bank_account(id),
  pay_method TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profile(user_id),

  CONSTRAINT chk_bk_receipt_documented CHECK (
    book <> 'bk' OR tax_doc_type IN ('tax_invoice_electronic','tax_invoice_paper','invoice','cash_receipt')
  ),
  CONSTRAINT chk_b_receipt_undocumented CHECK (
    book <> 'b' OR tax_doc_type = 'none'
  )
);
CREATE INDEX idx_receipt_book_date ON receipt(book, receipt_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_receipt_category ON receipt(category, book, receipt_on DESC);
```

---

## 14. 시세 (`price_history`, `price_curation`)

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

CREATE TABLE price_curation (
  market_item_id UUID PRIMARY KEY REFERENCES market_item(id),
  display_order INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 매입가 자동 누적 트리거 (v1.1: created_by lookup 보강)

```sql
CREATE OR REPLACE FUNCTION price_history_autofill_from_purchase()
RETURNS TRIGGER AS $$
DECLARE
  v_market_item UUID;
  v_price_per_kg NUMERIC;
  v_recorded_on DATE;
  v_actor UUID;
BEGIN
  SELECT i.market_item_id INTO v_market_item
    FROM item i WHERE i.id = NEW.item_id;
  IF v_market_item IS NULL THEN RETURN NEW; END IF;

  SELECT p.delivered_on, p.created_by
    INTO v_recorded_on, v_actor
    FROM purchase p WHERE p.id = NEW.purchase_id;
  IF v_recorded_on IS NULL THEN RETURN NEW; END IF;

  IF NEW.acquired_unit = 'kg' THEN
    v_price_per_kg := NEW.unit_price_krw;
  ELSIF NEW.acquired_unit = 'ton' THEN
    v_price_per_kg := NEW.unit_price_krw / 1000;
  ELSIF NEW.theoretical_weight_kg IS NOT NULL AND NEW.acquired_qty > 0 THEN
    v_price_per_kg := (NEW.unit_price_krw * NEW.acquired_qty) / NEW.theoretical_weight_kg;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO price_history
    (market_item_id, recorded_on, price_per_unit, unit, price_type, source, source_label, recorded_by)
  VALUES
    (v_market_item, v_recorded_on, v_price_per_kg, 'kg', 'spot', 'purchase_derived', NEW.purchase_id::TEXT, v_actor)
  ON CONFLICT (market_item_id, recorded_on, source, price_type) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_price_autofill_from_purchase
AFTER INSERT ON purchase_line
FOR EACH ROW EXECUTE FUNCTION price_history_autofill_from_purchase();
```

---

## 15. 운영 — 영업·명함·정기업무·아이디어

```sql
CREATE TABLE sales_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contacted_on DATE NOT NULL,
  partner_id UUID REFERENCES partner(id),
  prospect_name TEXT,
  contact_person TEXT,
  channel TEXT,
  result TEXT,
  follow_up_on DATE,
  notes TEXT,
  created_by UUID REFERENCES user_profile(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE business_card (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_on DATE,
  partner_id UUID REFERENCES partner(id),
  name TEXT NOT NULL,
  title TEXT,
  company TEXT,
  phone TEXT, email TEXT, address TEXT,
  image_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE recurring_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  cadence TEXT NOT NULL,
  due_rule TEXT,
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
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE improvement_idea (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT,
  proposed_by UUID REFERENCES user_profile(user_id),
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  notes TEXT
);
```

---

## 16. Audit log

```sql
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id UUID NOT NULL,
  book book_type,
  action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  before JSONB,
  after JSONB,
  changed_columns TEXT[],
  actor UUID,                                    -- NULL 허용 (시드/시스템)
  actor_label TEXT,                              -- 'system','seed','job' 등 라벨
  ip INET,
  ua TEXT,
  sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_table_row ON audit_log(table_name, row_id);
CREATE INDEX idx_audit_book_at ON audit_log(book, at DESC);
CREATE INDEX idx_audit_sensitive ON audit_log(sensitive, at DESC) WHERE sensitive = TRUE;

CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
DECLARE
  v_book book_type;
  v_row_id UUID;
  v_before JSONB;
  v_after JSONB;
  v_changed TEXT[];
  v_actor UUID;
  v_actor_label TEXT;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF v_actor IS NULL THEN
    v_actor_label := current_setting('app.system_actor_label', TRUE);
    IF v_actor_label IS NULL THEN v_actor_label := 'system'; END IF;
  END IF;

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

  INSERT INTO audit_log
    (table_name, row_id, book, action, before, after, changed_columns, actor, actor_label, sensitive)
  VALUES
    (TG_TABLE_NAME, v_row_id, v_book, TG_OP, v_before, v_after, v_changed, v_actor, v_actor_label, v_book = 'b');

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 적용 대상 (전 거래성 + 마스터 중요 테이블)
CREATE TRIGGER trg_audit_purchase           AFTER INSERT OR UPDATE OR DELETE ON purchase           FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_purchase_line      AFTER INSERT OR UPDATE OR DELETE ON purchase_line      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_sale               AFTER INSERT OR UPDATE OR DELETE ON sale               FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_sale_line          AFTER INSERT OR UPDATE OR DELETE ON sale_line          FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_allocation         AFTER INSERT OR UPDATE OR DELETE ON sale_line_allocation FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_book_transfer      AFTER INSERT OR UPDATE OR DELETE ON book_transfer      FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_bank_txn           AFTER INSERT OR UPDATE OR DELETE ON bank_transaction   FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_inventory_adj      AFTER INSERT OR UPDATE OR DELETE ON inventory_adjustment FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_receipt            AFTER INSERT OR UPDATE OR DELETE ON receipt            FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_promissory_note    AFTER INSERT OR UPDATE OR DELETE ON promissory_note    FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_bank_account       AFTER INSERT OR UPDATE OR DELETE ON bank_account       FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER trg_audit_consignment_in     AFTER INSERT OR UPDATE OR DELETE ON consignment_in     FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

> 시드/시스템 작업 시: `SET LOCAL app.system_actor_label = 'seed_20260601'` 같이 세션 변수 설정 → audit_log에 actor=NULL, actor_label='seed_20260601' 기록됨.

---

## 17. View / Materialized View

### 17.1 재고

```sql
CREATE OR REPLACE VIEW vw_inventory AS
SELECT
  pl.id AS purchase_line_id,
  pl.book,
  pl.warehouse_id,
  pl.warehouse_zone_id,
  pl.item_id,
  pl.acquired_unit,
  pl.acquired_qty,
  pl.acquired_qty - COALESCE(SUM(a.allocated_qty), 0) AS remaining_qty,
  pl.theoretical_weight_kg,
  pl.actual_weight_kg,
  COALESCE(pl.actual_weight_kg, pl.theoretical_weight_kg, 0)
    - COALESCE(SUM(a.allocated_weight_kg), 0) AS remaining_weight_kg,
  pl.unit_price_krw,
  pl.grade, pl.length_mm, pl.bars_count,
  pl.status, pl.created_at AS acquired_at
FROM purchase_line pl
LEFT JOIN sale_line_allocation a ON a.purchase_line_id = pl.id
WHERE pl.deleted_at IS NULL
  AND pl.status NOT IN ('transferred_out','scrapped')
GROUP BY pl.id
HAVING pl.acquired_qty - COALESCE(SUM(a.allocated_qty), 0) > 0;

CREATE OR REPLACE VIEW vw_inventory_by_book_item AS
SELECT book, item_id,
  SUM(remaining_qty)        AS total_qty,
  SUM(remaining_weight_kg)  AS total_weight_kg,
  COUNT(*)                  AS line_count
FROM vw_inventory
GROUP BY book, item_id;
```

### 17.2 시세

```sql
CREATE OR REPLACE VIEW vw_today_market_price AS
WITH ranked AS (
  SELECT ph.*,
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

CREATE OR REPLACE VIEW vw_inventory_valuation AS
SELECT
  inv.book, inv.item_id,
  inv.total_weight_kg,
  tp.price_per_unit AS market_price_per_kg,
  inv.total_weight_kg * tp.price_per_unit AS valuation_krw
FROM vw_inventory_by_book_item inv
JOIN item i ON i.id = inv.item_id
LEFT JOIN vw_today_market_price tp ON tp.market_item_id = i.market_item_id;
```

### 17.3 책별 P&L — 내부용 vs 신고용 (v1.1 분리)

```sql
-- 내부 관리용: 전부 포함 (B 책도 포함, is_documented 무관)
CREATE OR REPLACE VIEW vw_book_monthly_pnl_internal AS
SELECT
  s.book,
  DATE_TRUNC('month', s.ordered_on)::DATE AS month,
  SUM(s.subtotal_krw)                            AS revenue_krw,
  COALESCE(SUM(alloc.cost_krw), 0)               AS cogs_krw,
  SUM(s.subtotal_krw) - COALESCE(SUM(alloc.cost_krw), 0) AS gross_profit_krw
FROM sale s
LEFT JOIN sale_line sl ON sl.sale_id = s.id AND sl.deleted_at IS NULL
LEFT JOIN sale_line_allocation alloc ON alloc.sale_line_id = sl.id
WHERE s.deleted_at IS NULL AND s.status NOT IN ('cancelled')
GROUP BY s.book, DATE_TRUNC('month', s.ordered_on);

-- 부가세·세무 신고용: BK 전체 + SL의 documented만, B 제외
CREATE OR REPLACE VIEW vw_book_monthly_pnl_filing AS
SELECT
  s.book,
  DATE_TRUNC('month', s.ordered_on)::DATE AS month,
  SUM(s.subtotal_krw)                            AS revenue_krw,
  SUM(s.vat_krw)                                 AS vat_krw,
  COALESCE(SUM(alloc.cost_krw), 0)               AS cogs_krw,
  SUM(s.subtotal_krw) - COALESCE(SUM(alloc.cost_krw), 0) AS gross_profit_krw
FROM sale s
LEFT JOIN sale_line sl ON sl.sale_id = s.id AND sl.deleted_at IS NULL
LEFT JOIN sale_line_allocation alloc ON alloc.sale_line_id = sl.id
WHERE s.deleted_at IS NULL
  AND s.status NOT IN ('cancelled')
  AND s.is_documented = TRUE
  AND s.book IN ('bk','sl')
GROUP BY s.book, DATE_TRUNC('month', s.ordered_on);
```

### 17.4 부가세 신고 후보 view (v1.1 신규)

```sql
CREATE OR REPLACE VIEW vw_vat_eligible_sale AS
SELECT * FROM sale
WHERE deleted_at IS NULL
  AND is_documented = TRUE
  AND book IN ('bk','sl')
  AND vat_type IN ('standard_10','zero_rated');

CREATE OR REPLACE VIEW vw_vat_eligible_purchase AS
SELECT * FROM purchase
WHERE deleted_at IS NULL
  AND is_documented = TRUE
  AND book IN ('bk','sl')
  AND vat_type IN ('standard_10','zero_rated');
```

---

## 18. RLS 정책 (전 거래성 테이블 통합 적용)

```sql
-- 공통 패턴 (예: purchase). 모든 거래성 테이블에 동일 패턴 적용.
ALTER TABLE purchase             ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_line        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_line            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_line_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_account         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transaction     ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt              ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_transfer        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustment ENABLE ROW LEVEL SECURITY;
ALTER TABLE promissory_note      ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_in       ENABLE ROW LEVEL SECURITY;  -- owner/manager 전용

-- 마스터/공유는 인증된 모든 사용자 SELECT, owner/manager만 WRITE
ALTER TABLE partner              ENABLE ROW LEVEL SECURITY;
ALTER TABLE item                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse            ENABLE ROW LEVEL SECURITY;

-- ============== 거래성 표준 패턴 ==============
-- 책 컬럼 있는 테이블에 동일 패턴 적용
-- (purchase 예시; sale/purchase_line/sale_line/receipt/bank_*/book_transfer/inventory_adjustment/promissory_note 동일)
CREATE POLICY p_purchase_read   ON purchase FOR SELECT
  USING (current_user_has_book_role(book, 'viewer'));
CREATE POLICY p_purchase_insert ON purchase FOR INSERT
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_purchase_update ON purchase FOR UPDATE
  USING (current_user_has_book_role(book, 'staff'))
  WITH CHECK (current_user_has_book_role(book, 'staff'));
CREATE POLICY p_purchase_delete ON purchase FOR DELETE
  USING (current_user_has_book_role(book, 'manager'));

-- book_transfer는 양쪽 책 권한 모두 필요
CREATE POLICY p_transfer_read ON book_transfer FOR SELECT
  USING (current_user_has_book_role(source_book, 'viewer')
      OR current_user_has_book_role(dest_book, 'viewer'));
CREATE POLICY p_transfer_insert ON book_transfer FOR INSERT
  WITH CHECK (current_user_has_book_role(source_book, 'manager')
          AND current_user_has_book_role(dest_book, 'manager'));
CREATE POLICY p_transfer_update ON book_transfer FOR UPDATE
  USING (current_user_has_book_role(source_book, 'manager')
     AND current_user_has_book_role(dest_book, 'manager'))
  WITH CHECK (current_user_has_book_role(source_book, 'manager')
          AND current_user_has_book_role(dest_book, 'manager'));

-- consignment_in: owner/manager 전용 (책 무관)
CREATE POLICY p_consignment_in_owner ON consignment_in FOR ALL
  USING (EXISTS (
    SELECT 1 FROM user_book_role WHERE user_id = auth.uid()
      AND role IN ('owner','manager')
  ));

-- 마스터 공유 (SELECT는 누구나, WRITE는 owner/manager)
CREATE POLICY p_partner_read ON partner FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY p_partner_write ON partner FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM user_book_role WHERE user_id = auth.uid() AND role IN ('owner','manager'))
);
-- (item, warehouse, bank_account 등에도 같은 패턴 반복)
```

---

## 19. 인덱스 전략 요약

- 거래성: `(book, ordered_on DESC)` + `(partner_id, ordered_on DESC)` partial(`deleted_at IS NULL`)
- 결제 미완: `idx_purchase_unpaid`, `idx_sale_unsettled` partial
- 어음 만기: `idx_note_maturity` partial (`status='open'`)
- audit_log: `(table_name, row_id)`, `(book, at DESC)`, partial `sensitive=TRUE`
- price_history: `(market_item_id, recorded_on DESC)`
- partner 검색: `pg_trgm` GIN
- 모든 FK에 자동 인덱스 권장 (PG는 자동 X)

---

## 20. 첨부파일 JSONB 표준 구조

여러 테이블의 `attachments JSONB` 형식 통일:

```json
[
  {
    "id": "uuid-or-shortid",
    "url": "https://supabase-storage.../bucket/path.jpg",
    "filename": "거래명세표_20260512.pdf",
    "size": 234567,
    "mime": "application/pdf",
    "uploaded_at": "2026-05-12T10:23:00+09:00",
    "uploaded_by": "user_uuid",
    "kind": "tax_invoice | quotation | photo | etc"
  }
]
```

Supabase Storage 버킷 구조:
- `attachments/{table_name}/{row_id}/{file_id}.{ext}` — 행별 격리, RLS 정책 동일 책 권한자만 접근

---

## 21. 마이그레이션 — 5월 CSV → seed

| 원본 시트 | 대상 테이블 | 책 매핑 |
|---|---|---|
| `5.거래처.csv` | `partner` + `partner_alias` | 공유 |
| `1.매출.csv` | `sale` + `sale_line` | 통장 코드(`법인A`/`사업자A`/`B계좌`) → `bk`/`sl`/`b` |
| `2.매입.csv` | `purchase` + `purchase_line` | 동일 |
| `3.재고.csv` | (vw_inventory 검증용) | 검증 데이터 |
| `4.영수증.csv` | `receipt` | 결제 통장 → 책 |
| `6.통장.csv` | `bank_account` + `bank_transaction` | 통장 코드 그대로 |
| `7.정기업무.csv` | `recurring_task` + `recurring_task_log` | row별 |
| `8.미수관리.csv` | (vw_receivable 검증용) | 검증 데이터 |
| `9.영업내역.csv` | `sales_log` | 공유 |
| `10.명함.csv` | `business_card` | 공유 |
| `0.개선아이디어.csv` | `improvement_idea` | 공유 |

### 시드 절차
1. **세션 변수 설정**: `SET LOCAL app.system_actor_label = 'seed_20260601'`
2. enums + master (`partner`, `item`, `rebar_*`, `market_item`, `warehouse` + `warehouse_zone`, `bank_account`)
3. `partner_alias` 정합성 검증 (표기 충돌 해결)
4. `bank_transaction` (통장 흐름)
5. `purchase` + `purchase_line` (책·zone 매핑, 자동 트리거가 price_history도 채움)
6. `sale` + `sale_line` + `sale_line_allocation` (FIFO 자동 할당)
7. `receipt`, `recurring_task`, `sales_log`, `business_card`, `improvement_idea`
8. (선택) 수동 `price_history` seed — 5월 평균가
9. RLS 활성화 (시드 후)

---

## 22. 변경 이력

### v1.1 (2026-05-12) — 자체 리뷰 반영
**Critical 6개**
- 순환 FK 제거 (`book_transfer.paired_*` 삭제, 단방향 `sale/purchase.transfer_id` 만 유지)
- `purchase_line`/`sale_line` 등에 `deleted_at` 추가
- `book_transfer_type` 전용 enum 도입 (`sale_subtype` 재사용 금지)
- 책별 P&L view를 internal vs filing 두 종류로 분리
- `sale_line_allocation` 매칭 기준을 무게(`allocated_weight_kg`)로 명문화 + FIFO 기본 알고리즘
- audit 트리거의 `auth.uid()` NULL fallback + `app.system_actor_label` 세션 변수

**도메인 확정 6개**
- `vw_payable` (외상매입금) v1 포함
- 견적서는 `sale.status='reserved'` 로 흡수 (별도 테이블 v2)
- 선급금/예치금, 자본금/동업 정산, 고정자산 등록부, 직원/급여 → 모두 **v2 이연**

**보완 8개**
- `vat_type` enum 도입 (standard_10/zero_rated/exempt/non_taxable) + vat_rate 정합 CHECK
- `chk_bars_count_required` (가닥 단위면 bars_count NOT NULL)
- `inventory_adjustment`를 `kind('transform'|'delta')` + `reason`으로 의미 분리
- RLS 정책 전 테이블 패턴 명시
- `vw_vat_eligible_sale/purchase` 신고 후보 view
- `purchase_line.zone` 자유텍스트 → `warehouse_zone_id` FK 강제
- 첨부파일 JSONB 표준 구조 명문화
- 추가 인덱스 (`idx_purchase_unpaid`, `idx_sale_unsettled`, `idx_note_maturity`, `partner_name_trgm`)

### v1.0 (2026-05-12)
초안 작성.

---

## 23. v2 이연 / 미해결

- 선급금 / 예치금 (`partner_deposit`, `partner_advance`)
- 자본금 / 동업 정산
- 고정자산 / 차량 / 장비 등록부
- 직원 / 급여 (`employee`, `payroll`)
- 외부 시세 자동 import (스틸데일리 등 크롤링/API)
- 시스템 내 분개 더블엔트리 (현재는 export만)
- 반품·클레임 정식 워크플로우 (v1은 `inventory_adjustment(reason='return_*')` 수동)
- 할인·리베이트 사후 정산
- 품질 등급 재분류 워크플로우
- audit_log 보존 기간/아카이브 정책 (현재 영구)
- 세금계산서 발행 API 연동 (이세로/스마트빌 등)
