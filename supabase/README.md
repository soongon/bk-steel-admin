# Supabase 마이그레이션

> `docs/시스템_DB_스키마_v1.md` v1.1 청사진을 실제 PostgreSQL DDL로 옮긴 마이그레이션 + 시드.

## 구조

```
supabase/
├── migrations/         # 스키마 마이그레이션 (순차 실행)
│   ├── 0001_extensions.sql
│   ├── 0002_enums.sql
│   ├── 0003_auth_users.sql
│   ├── 0004_masters_shared.sql
│   ├── 0005_masters_book.sql
│   ├── 0006_purchase.sql
│   ├── 0007_sale.sql
│   ├── 0008_book_transfer.sql
│   ├── 0009_inventory_adjustment.sql
│   ├── 0010_consignment.sql
│   ├── 0011_bank_transaction.sql
│   ├── 0012_promissory_note.sql
│   ├── 0013_receipt.sql
│   ├── 0014_price_history.sql
│   ├── 0015_operations.sql
│   ├── 0016_audit.sql
│   ├── 0017_views.sql
│   └── 0018_rls.sql
└── seed/               # 시드 데이터 (마이그레이션 후 실행)
    ├── 0001_rebar_spec.sql       # KS D 3504 철근 규격
    ├── 0002_rebar_grade.sql      # SD300~SD700 강종
    └── 0003_market_item.sql      # 시세 분류 큐레이션 (운영 시작 시점 정리)

scripts/
└── migrate-may-data.ts            # 5월 워크북 CSV → Supabase 데이터 마이그레이션 (TS)
```

## 마이그레이션 파일명 규칙

`NNNN_kebab_or_snake_name.sql` 4자리 sequential. Supabase CLI 도입 시 timestamp 형식(`YYYYMMDDHHMMSS_*.sql`)으로 일괄 rename 가능 — 둘 다 lexicographic 정렬에서 동작.

## 실행 방법

### Supabase CLI 사용 (권장)

```bash
# Supabase CLI 설치 (Homebrew)
brew install supabase/tap/supabase

# 프로젝트 초기화 (이미 supabase/ 디렉토리가 있어도 OK — 다른 파일 추가만 됨)
supabase init

# 로컬 개발 DB 띄우기
supabase start

# 마이그레이션 적용
supabase db reset             # 처음부터 (마이그레이션 + seed 자동 실행)
# 또는
supabase migration up         # 누적 적용

# 시드 수동 실행
psql "$DATABASE_URL" -f supabase/seed/0001_rebar_spec.sql
psql "$DATABASE_URL" -f supabase/seed/0002_rebar_grade.sql
```

### 원격 Supabase 프로젝트 push

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## 시드 순서

1. 마이그레이션 0001~0018 적용 후 (스키마 완성)
2. `supabase/seed/` 의 SQL 순서대로 실행 (rebar_spec → rebar_grade → market_item)
3. `scripts/migrate-may-data.ts` 실행 (5월 워크북 데이터 import)

## 주의

- 모든 마이그레이션은 **재실행 가능(idempotent)** — `IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING` 사용
- audit 트리거는 0016에서 만들어지므로, 그 이전 시드는 audit_log 비어있는 채로 진행 후 활성화
- RLS는 0018에서 활성화 — 시드 작업은 그 전(또는 service role key 사용)에 완료해야 함
- 시드 작업 시 세션 변수 설정: `SET LOCAL app.system_actor_label = 'seed_YYYYMMDD'`
