<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# 프로젝트: SH철강(가칭) 운영 시스템 — 어드민

이 repo는 5월에 Excel 워크북으로 확정한 업무 룰을 **Next.js + Supabase 시스템**으로 옮기는 6월 산출물입니다.
원본 5월 사전 작업(Excel + Python 마이그레이션)은 `https://github.com/soongon/sl-steel-ops` 에 있고,
이 repo의 `docs/`는 그 컨텍스트를 그대로 가져온 사본입니다.

## 스택

- Next.js 16 (App Router, Turbopack)
- React 19
- Tailwind CSS 4
- shadcn/ui v4 (Base UI 기반, `base-nova` 스타일, **zinc** 팔레트)
- next-themes (다크모드), sonner (토스트)
- zustand 5 (클라이언트 상태)
- (예정) Supabase

## 작업 전 반드시 읽을 컨텍스트

작업 성격에 따라 다음 파일을 먼저 읽고 시작하세요:

| 작업 종류 | 필독 파일 |
|---|---|
| **DB / 테이블 / 스키마 설계** | **`docs/시스템_DB_스키마_v1.md`** (주), `docs/시스템_도메인_룰_v1.md`, `docs/시스템_DB_스키마_v0.md` (v0 참고), `docs/도메인_룰.md` (5월 워크북 룰) |
| **도메인 룰(3축 분리·이관·세금계산서·재고·시세 등)** | **`docs/시스템_도메인_룰_v1.md`** ← 6월 시스템 기준 |
| **5월 워크북 시점 룰(B계좌·미수 등급·상태 머신 등)** | `docs/도메인_룰.md` |
| **데이터 마이그레이션 / 시드 작업** | `docs/마이그레이션_사용법.md`, `docs/reference-data/*.csv` |
| **양식·컬럼 구조 이해** | `docs/워크북_변경이력.md`, `docs/원본_도구/workbook/create_spreadsheets.py` |
| **철근 규격·단위중량·번들 환산** | `docs/철근_제품마스터.md` (KS D 3504, rebar_specs/rebar_grades 시드) |
| **5월 한 달 운영 맥락** | `docs/세션_로그/*.md` |
| **사업/동업 컨텍스트(원본 안내)** | `docs/컨텍스트_README.md` (실제 사업 컨텍스트는 Claude.ai Project Knowledge) |
| **원본 repo 사용 가이드 원문** | `docs/원본_CLAUDE.md`, `docs/원본_README.md` |

## 절대 룰 (도메인)

원본 `CLAUDE.md`에서 가져온 핵심 룰. 시스템 설계/구현 시 모두 강제해야 합니다:

1. **법인은 100% 정상거래만** — 법인 사업자 코드(`법인A`)에 무자료 거래 절대 금지.
2. **B계좌 거래는 시각·권한 분리 유지** — 통장 코드 `B계좌`는 별도 강조 + 부가세 신고 시 자동 제외.
3. **거래처명 마스터(`5.거래처`)와 정합성 유지** — 매출·매입의 거래처명은 마스터에 등록된 표준명과 정확히 일치해야 함. `9.영업내역`/`10.명함`은 prospecting 단계라 자유 텍스트 허용. 현장명은 거래처와 분리(매출 시트 E열).
4. **자동수식 컬럼은 데이터로 덮어쓰지 않음** — 원본 `migrate.py`의 `formula_cols` 정의 참조.

## 도메인 약어

| 약어 | 의미 |
|---|---|
| **법인** | 새로 설립할 SH철강 법인 (50:50 동업) |
| **사업자** | 친구의 개인사업자 SL철강 (5월 운영 주체) |
| **B계좌** | 친구 사업자의 히든 통장 — 무자료 거래 입금용 |
| **법인A / 사업자A / B계좌** | 통장 코드 |
| **상태 머신** | 매출: 주문→납품완료→수금완료(+연체) · 매입: 발주→입고완료→결제완료(+결제연체) |
| **미수 등급** | 정상(예정일 미도래) / 단기(1~7일) / 중기(8~30일) / 장기(31일+) |

## 폴더 구조 (현재)

```
bk-steel-admin/
├── app/                    ← Next.js App Router
├── components/
│   ├── ui/                 ← shadcn/ui 컴포넌트
│   └── providers.tsx       ← ThemeProvider + TooltipProvider
├── hooks/                  ← use-mobile 등
├── lib/                    ← utils (cn)
├── docs/                   ← 도메인 컨텍스트 (sl-steel-ops 사본)
│   ├── 도메인_룰.md
│   ├── 시스템_DB_스키마_v0.md
│   ├── 워크북_변경이력.md
│   ├── 마이그레이션_사용법.md
│   ├── 세션_로그/
│   ├── reference-data/     ← CSV (Supabase seed/import 베이스)
│   ├── 원본_도구/          ← migrate.py, create_spreadsheets.py 등 참조
│   ├── 원본_CLAUDE.md
│   ├── 원본_README.md
│   └── 컨텍스트_README.md
├── components.json         ← shadcn config (baseColor: zinc)
└── AGENTS.md / CLAUDE.md
```
