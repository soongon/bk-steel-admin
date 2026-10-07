/**
 * 발주 레이더(Construction Order Radar) 도메인 타입 — v2.
 *
 * 경주 중심 건설 발주를 공공데이터로 수집해, 영업이 "오늘 방문할 현장 / 오늘 걸 전화"만 보는 인텔리전스.
 * 운영(매출·매입·통장)과 완전 분리된 외부 정상데이터. book(법인/사업자/B계좌) 차원과 무관 —
 * B계좌·무자료와 절대 엮지 않는다.
 *
 * v2(2026-10): 등급·점수·추정톤·배송차량·신선도·매입 뷰·시청 고시 폐기. 규칙은 lib/radar/v2-rules.ts.
 * 기획안: docs/발주_레이더_v2_기획.md
 */

// ── 소스(어댑터) ──────────────────────────────────────────────
export const RADAR_SOURCES = ["building_permit", "nara_bid"] as const;
export type RadarSource = (typeof RADAR_SOURCES)[number];

export const RADAR_SOURCE_LABEL: Record<RadarSource, string> = {
  building_permit: "민간 건축",
  nara_bid: "관급 나라장터",
};

// ── 권역 ──────────────────────────────────────────────────────
export const RADAR_REGIONS = ["gyeongju", "pohang", "ulsan"] as const;
export type RadarRegion = (typeof RADAR_REGIONS)[number];

export const RADAR_REGION_LABEL: Record<RadarRegion, string> = {
  gyeongju: "경주",
  pohang: "포항",
  ulsan: "울산",
};

// ── 민간/관급 ─────────────────────────────────────────────────
export const PROJECT_TYPES = ["private", "public"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  private: "민간",
  public: "관급",
};

// ── 단계 ──────────────────────────────────────────────────────
export const RADAR_STAGES = [
  "permit", //              민간: 건축허가 (착공 전) — 선점
  "construction_start", //  민간: 착공신고 — 방문
  "completed", //           민간: 사용승인(준공) — 리스트 이탈
  "bid_notice", //          관급: 입찰공고 (낙찰 전) — 화면 미노출(조인용)
  "awarded", //             관급: 낙찰 확정 — 낙찰사 전화
] as const;
export type RadarStage = (typeof RADAR_STAGES)[number];

export const RADAR_STAGE_LABEL: Record<RadarStage, string> = {
  permit: "허가",
  construction_start: "착공",
  completed: "준공",
  bid_notice: "입찰공고",
  awarded: "낙찰",
};

// ── 구조 ──────────────────────────────────────────────────────
export const STRUCTURE_TYPES = ["RC", "steel", "etc"] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];

/** 용도/공종 표시 라벨. 민간은 buildingPermit.normalizeUsage 키, 관급은 nara-rules.NaraLabel. */
export const USAGE_LABEL: Record<string, string> = {
  factory: "공장",
  warehouse: "창고",
  neighborhood: "근린생활",
  multi_family: "다세대·다가구",
  apartment: "공동주택",
  education: "교육",
  etc: "기타",
  rc: "철근콘크리트 공사",
  civil: "토목·기타 공사",
  non_steel: "비철근 공종",
};

// ── 데이터 흐름 타입 ──────────────────────────────────────────

/**
 * 어댑터(collector)가 뱉는 정규화 결과. 모든 소스 어댑터는 이 형태의 배열을 반환한다.
 */
export interface CollectedProject {
  source: RadarSource;
  source_key: string; // 소스 자연키 (sigunguCd-허가대장PK or 공고번호)
  region: RadarRegion;
  sigungu_code: string | null;
  project_type: ProjectType;
  title: string;
  address: string | null;
  usage: string | null; // 민간: 용도 카테고리 / 관급: rc·civil·non_steel 라벨
  structure: StructureType | null;
  floor_area: number | null; // ㎡
  stage: RadarStage;
  stage_date: string | null; // ISO date — 현재 단계 기준일(허가일/착공일/공고일/낙찰일)
  permit_date: string | null;
  sched_start_date: string | null;
  start_date: string | null;
  completion_date: string | null;
  ordering_org: string | null; // 발주처 (관급, 표시용 — 연락 대상 아님)
  contact_party: string | null; // 연락 주체 요약 (관급: "낙찰사 · 전화")
  awarded_company: string | null; // 낙찰사명
  est_amount: number | null; // 낙찰금액/추정가격 (관급)
  source_url?: string | null;
  raw: unknown; // 원시 응답 (입찰공고+낙찰 병합 보존)
}

/**
 * DB(construction_project) 행 — UI 조회 결과 형태(raw 제외).
 * relevance_*·est_rebar_ton 은 v2에서 쓰지 않지만 컬럼은 남아 있어(DROP 안 함) nullable로 둔다.
 */
export interface RadarProjectRow {
  id: string;
  source: RadarSource;
  source_key: string;
  region: RadarRegion;
  sigungu_code: string | null;
  project_type: ProjectType;
  title: string;
  address: string | null;
  usage: string | null;
  structure: StructureType | null;
  floor_area: number | null;
  stage: RadarStage;
  stage_date: string | null;
  permit_date: string | null;
  sched_start_date: string | null;
  start_date: string | null;
  completion_date: string | null;
  ordering_org: string | null;
  contact_party: string | null;
  awarded_company: string | null;
  est_amount: number | null;
  source_url: string | null;
  linked_partner_id: string | null;
  // v2 (0069)
  dismissed_at: string | null;
  dismiss_reason: string | null;
  stage_changed_at: string | null; // 단계가 DB에 반영된 시각 — 방문 창·'오늘' 판정 기준
  awardee_bizno: string | null; // 낙찰사 사업자번호(숫자만, 생성 컬럼)
  last_seen_at: string | null; // 수집기가 마지막으로 이 행을 받은 시각(0070) — 헤더 '동기화'(max)
  created_at: string; // = 최초 수집(first seen)
  updated_at: string; // = 최종 갱신
}
