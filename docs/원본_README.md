# SH철강 운영 시스템 — 5월 사전 작업

> 5월 한 달간 Excel 워크북으로 업무 룰을 확정하고, 6월에 그 룰을 그대로 Next.js + Supabase 시스템으로 이전하기 위한 repo.
>
> **양식(코드)과 데이터(CSV)를 분리해서, 양식이 바뀌어도 데이터가 살아남도록.**

---

## 폴더 구조

```
sh-steel-ops/
├── CLAUDE.md                     ← Claude Code 자동 컨텍스트
├── README.md                     ← 이 파일
├── Makefile                      ← make sync, make extract 등
├── .gitignore
│
├── workbook/
│   ├── create_spreadsheets.py    ← 양식 정의 (build_workbook 함수)
│   └── output/
│       └── SL철강_5월_운영시트.xlsx  ← 친구·직원이 보는 파일 (gitignored)
│
├── data/                         ← truth source. CSV들 (git 추적)
│   ├── 1.매출.csv
│   ├── 2.매입.csv
│   ├── 3.재고.csv
│   ├── 4.영수증.csv
│   ├── 5.거래처.csv
│   ├── 6.통장.csv
│   ├── 7.정기업무.csv
│   ├── 8.미수관리.csv
│   └── 0.개선아이디어.csv
│
├── migrate.py                    ← extract / rebuild / sync
│
├── docs/
│   ├── 도메인_룰.md              ← 비즈니스 룰 (B계좌, 미수금 등급, 상태 머신)
│   ├── 마이그레이션_사용법.md    ← migrate.py 운용 가이드
│   ├── 워크북_변경이력.md        ← 5월 한 달간 양식 변경 이력
│   ├── 시스템_DB_스키마_v0.md    ← 6월 시스템용 DB 스키마 초안
│   └── 컨텍스트/                 ← Project Knowledge용 핵심 컨텍스트 (.md 5개)
│
└── tests/                        ← 마이그레이션 테스트 (선택)
```

---

## 핵심 원칙

**xlsx는 view, CSV가 truth source.**

- `data/*.csv` 파일들이 진실의 원천. git으로 추적 → 변경 이력 자동.
- `workbook/output/*.xlsx`는 생성물. 친구·직원에게 배포되는 view.
- `workbook/create_spreadsheets.py`는 양식 정의. 데이터 0건의 빈 양식도 만들 수 있음.

**양식 변경은 항상 sync 사이클을 거친다.**

```
extract → 코드 수정 → rebuild
   ↓         ↓           ↓
xlsx의    create_      빈 양식 + 
데이터    spreadsheets CSV 데이터
→ CSV     .py 수정     → 새 xlsx
```

---

## 빠른 시작

### 1. 의존성 설치

```bash
pip install openpyxl
```

### 2. 첫 워크북 생성 (5월 1일 첫 시작)

```bash
python workbook/create_spreadsheets.py
# → workbook/output/SL철강_5월_운영시트.xlsx 생성 (샘플 데이터 포함)
```

### 3. 친구·직원에게 배포

iCloud Drive 또는 Google Drive에 워크북 업로드 → 친구·직원이 모바일/데스크톱 Excel·Numbers로 입력.

### 4. 매주 일요일 점검

```bash
make sync               # extract + rebuild 한 사이클
git add data/
git commit -m "data: 5월 첫째 주 동기화"
```

### 5. 양식 변경이 필요할 때

```bash
make extract            # 1. 현재 데이터를 CSV로 백업
# create_spreadsheets.py 수정 (Claude Code에서)
make rebuild            # 2. 새 양식 + 기존 데이터 → 새 xlsx
git commit -am "feat: 매입 시트에 어음만기일 컬럼 추가"
```

상세는 [`docs/마이그레이션_사용법.md`](docs/마이그레이션_사용법.md) 참조.

---

## Makefile 명령

| 명령 | 설명 |
|---|---|
| `make build` | 샘플 포함 워크북 생성 (첫 시작 시 1회) |
| `make extract` | xlsx → CSV 추출 |
| `make rebuild` | 빈 양식 + CSV → xlsx |
| `make sync` | extract + rebuild (양식 변경 사이클) |
| `make backup` | data/ 디렉토리를 backup/YYYY-MM-DD/로 복사 |
| `make clean` | 생성물 삭제 (CSV는 보존) |

---

## 5월 → 6월 전환

5월 한 달 동안:
- `data/*.csv`에 한 달 운영 데이터 누적
- `docs/워크북_변경이력.md`에 양식 진화 이력 기록
- `docs/시스템_DB_스키마_v0.md`를 점진적으로 다듬기
- `0.개선아이디어` 시트에 시스템 요구사항 누적

6월 시작 시:
- 같은 repo에 `system/` 폴더 추가 (Next.js + Supabase)
- `data/*.csv`를 Supabase에 `COPY FROM CSV`로 import
- `create_spreadsheets.py`의 마지막 버전 = DB 스키마 v1
- 친구·직원은 Excel 대신 PWA(시스템)로 자연스럽게 전환

---

## 관련 문서

- [도메인 룰](docs/도메인_룰.md) — B계좌 처리, 상태 머신, 미수금 등급
- [마이그레이션 사용법](docs/마이그레이션_사용법.md) — migrate.py 운용 시나리오
- [워크북 변경이력](docs/워크북_변경이력.md) — 양식 진화 로그
- [시스템 DB 스키마 v0](docs/시스템_DB_스키마_v0.md) — 6월 시스템용
- [컨텍스트](docs/컨텍스트/) — 사업·동업·자본구조 핵심 자료
