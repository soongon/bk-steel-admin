# SH철강 운영 시스템 — Claude Code 컨텍스트

이 repo는 SH철강 동업의 운영 시스템 사전 작업을 담는다.

- **5월**: Excel 워크북으로 업무 룰 확정
- **6월**: 룰을 그대로 Next.js + Supabase 시스템으로 이전

---

## 매번 작업 전 읽어야 할 컨텍스트

작업 성격에 따라 다음 파일들을 먼저 읽어주세요:

| 작업 종류 | 필독 파일 |
|---|---|
| **워크북 양식 변경** | `docs/도메인_룰.md`, `workbook/create_spreadsheets.py`, `docs/워크북_변경이력.md` |
| **마이그레이션 작업** | `docs/마이그레이션_사용법.md`, `migrate.py` |
| **시스템 스키마 설계** | `docs/시스템_DB_스키마_v0.md`, `docs/도메인_룰.md` |
| **사업적 의사결정** | `docs/컨텍스트/최종_컨텍스트_요약.md` |

---

## 절대 룰 (어기면 안 됨)

1. **법인은 100% 정상거래만** — 법인 사업자 코드(`법인A`)에 무자료 거래 절대 금지
2. **B계좌 거래는 시각·권한 분리 유지** — 통장 코드 `B계좌`는 별도 강조 + 부가세 신고 시 자동 제외
3. **거래처명 마스터(5.거래처)와 정합성 유지** — `1.매출`/`2.매입` 시트의 거래처명이 `5.거래처` 시트에 등록된 것과 정확히 일치해야 함 (SUMIFS 매칭). `1.매출` D열은 data validation으로 5.거래처 마스터에서만 선택 가능 (null 허용). **`9.영업내역`/`10.명함`은 예외** — 콜드 prospecting/명함 자유 텍스트 허용. **현장명은 `1.매출` E열(현장)에 별도 기록** — 거래처와 분리
4. **양식 변경 시 반드시 `docs/워크북_변경이력.md` 갱신**
5. **자동수식 컬럼은 데이터로 덮어쓰지 않음** — `migrate.py`의 `formula_cols` 정의 준수

---

## 작업 패턴

### 양식 변경 시

```
1. python migrate.py extract               # 현재 데이터 백업
2. workbook/create_spreadsheets.py 수정    # 양식 정의 변경
3. (필요시) migrate.py의 SHEETS 메타 갱신   # 컬럼 추가/이름 변경 시
4. python migrate.py rebuild               # 새 양식 + 기존 데이터
5. docs/워크북_변경이력.md 갱신            # 변경 사유와 영향 기록
6. git commit -m "feat/fix/chore: 변경 내용"
```

### 마이너 변경 (메모, 색상, 드롭다운 옵션 추가)

위와 동일 — 코드 기반 워크플로우에서는 `extract → rebuild`가 항상 안전한 길.

### 메이저 변경 (컬럼 이름 변경/삭제)

`migrate.py`의 `SHEETS` 딕셔너리에 컬럼 매핑 정보 일시 추가 → rebuild → 매핑 정보 다시 제거.

---

## 환경

- Python 3.10+
- openpyxl (워크북 생성/수정)
- 빌드 의존성: `pip install openpyxl`
- 운영 환경: macOS (사용자) + Linux/Mac (개발)
- Excel 파일 인코딩: UTF-8 (CSV는 BOM 포함 — Excel 한글 호환)

---

## 도메인 약어

| 약어 | 의미 |
|---|---|
| **법인** | 새로 설립할 SH철강 법인 (50:50 동업) |
| **사업자** | 친구의 개인사업자 SL철강 (5월 운영 주체) |
| **B계좌** | 친구 사업자의 히든 통장 — 무자료 거래 입금용 |
| **법인A / 사업자A / B계좌** | 통장 코드 (`6.통장`, `매출.R열`, `매입.R열`). B계좌는 친구 사업자의 무자료 거래용 히든 통장 |
| **상태 머신** | 매출: 주문→납품완료→수금완료(+연체) / 매입: 발주→입고완료→결제완료(+결제연체) |
| **미수 등급** | 정상(예정일 미도래) / 단기(1~7일) / 중기(8~30일) / 장기(31일+) |

---

## 자주 하는 실수 — 회피 가이드

- **`load_workbook(..., data_only=True)` 후 `wb.save()` 절대 금지** — 수식이 값으로 덮어씌워져 영구 손실
- **`make build` 또는 `python workbook/create_spreadsheets.py` (samples=True) 절대 금지** — 5월 1일 첫 시작 후엔 절대 사용 X. xlsx가 샘플로 덮어씌워지고 이후 extract/sync로 샘플이 CSV에 새겨져 실데이터 손실. 안전장치가 거부하지만 `--force` 우회 금지. 양식 재생성은 `make rebuild`.
- **거래처명 표기 불일치** — "OO건설" / "OO 건설" / "(주)OO건설" 같은 미세한 차이로 SUMIFS 깨짐. 등록 시 표준화 강제.
- **자동수식 컬럼에 데이터 주입** — `migrate.py`의 `formula_cols` 무시하고 값 넣으면 수식 깨짐
- **헤더 행 위치 혼동** — 시트마다 헤더 행이 1 또는 4. `migrate.py`의 `SHEETS[name]['header_row']` 참조
- **영수증 시트의 J~L 영역** — 데이터 영역이 아니라 합계 수식 영역. `max_col=8`로 데이터 영역만 처리

---

## 이 repo가 6월에 어떻게 진화하는가

5월 마지막 주 (5/25~5/31)에 변경 동결. 6월 1일부터:

```
sh-steel-ops/                ← 같은 repo
├── workbook/                ← 5월 산출물 (참고용)
├── data/                    ← Supabase로 import
├── system/                  ← 신규: Next.js + Supabase 시스템
│   ├── apps/
│   │   ├── web/             ← 어드민 + 친구·직원용 PWA
│   │   └── ...
│   ├── packages/
│   │   ├── db/              ← Supabase migrations
│   │   └── ...
│   └── ...
└── docs/시스템_DB_스키마_v1.md  ← v0 진화
```

`workbook/create_spreadsheets.py`의 마지막 버전 = `system/packages/db/migrations/0001_initial_schema.sql`의 베이스.
