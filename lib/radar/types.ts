/**
 * 발주 레이더(Construction Order Radar) 도메인 타입.
 *
 * 경주·포항·울산 건설 발주를 공공데이터로 수집·점수화해, 영업이 "어디에 / 언제 /
 * 누구한테" 전화할지 보는 인텔리전스. 운영(매출·매입·통장)과 완전 분리된 외부 정상데이터다.
 * book(법인/사업자/B계좌) 차원과 무관 — B계좌·무자료와 절대 엮지 않는다.
 *
 * 참조(핸드오프): §2 연락주체, §4 스키마, §5 단계, §6 점수
 */

// ── 소스(어댑터) ──────────────────────────────────────────────
export const RADAR_SOURCES = ["building_permit", "nara_bid", "notice"] as const;
export type RadarSource = (typeof RADAR_SOURCES)[number];

export const RADAR_SOURCE_LABEL: Record<RadarSource, string> = {
  building_permit: "민간 건축",
  nara_bid: "관급 나라장터",
  notice: "시청 고시(선점)",
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

// ── 단계(상태 머신) — 핸드오프 §5 ─────────────────────────────
export const RADAR_STAGES = [
  "permit", //              민간: 건축허가 (착공 전) — 모니터링
  "construction_start", //  민간: 착공신고 — 지금 전화(빨강)
  "completed", //           민간: 사용승인(준공) — 기회 끝(숨김)
  "bid_notice", //          관급: 입찰공고 (낙찰 전) — 대기
  "awarded", //             관급: 낙찰 확정 — 낙찰사에 전화(파랑)
  "notice", //              시청 고시: 대형 개발 선점 (산단·정비·대형건축) — 가장 이른 신호
] as const;
export type RadarStage = (typeof RADAR_STAGES)[number];

export type StageMeta = {
  label: string;
  /** now=지금 전화 / watch=모니터링 / done=기회 끝 */
  urgency: "now" | "watch" | "done";
  /** 단계 칩 Tailwind 클래스 (긴급도 = 색). */
  className: string;
};

export const RADAR_STAGE_META: Record<RadarStage, StageMeta> = {
  permit: {
    label: "건축허가",
    urgency: "watch",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300",
  },
  construction_start: {
    label: "착공신고",
    urgency: "now",
    className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  },
  completed: {
    label: "사용승인",
    urgency: "done",
    className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-500",
  },
  bid_notice: {
    label: "입찰공고",
    urgency: "watch",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300",
  },
  awarded: {
    label: "낙찰확정",
    urgency: "now",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  },
  notice: {
    label: "고시·선점",
    urgency: "watch",
    className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  },
};

// ── 구조 ──────────────────────────────────────────────────────
export const STRUCTURE_TYPES = ["RC", "steel", "etc"] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];

export const STRUCTURE_LABEL: Record<StructureType, string> = {
  RC: "철근콘크리트",
  steel: "철골",
  etc: "기타",
};

// ── 민간 라이프사이클 — 영업 보드 ────────────────────────────

/**
 * 배송 차량 '가설'(확정 아님) — 규모로 추정. 거리·접근성은 미반영이라 힌트 수준.
 *  25t=대량(공장·창고·대형), 5t=소형 확실, unsure=중간/미상(현장 확인).
 */
export type DeliveryTier = "5t" | "25t" | "unsure";
export function estimateDeliveryTier(
  floorArea: number | null,
  usage: string | null,
): DeliveryTier {
  if (usage === "factory" || usage === "warehouse") return "25t";
  if (floorArea != null && floorArea >= 1000) return "25t";
  if (floorArea != null && floorArea > 0 && floorArea < 300) return "5t";
  return "unsure"; // 중간 규모·면적 미상 — 차량은 현장 확인
}
export const DELIVERY_LABEL: Record<DeliveryTier, string> = {
  "5t": "5톤 유리",
  "25t": "25톤 대량",
  unsure: "차량 확인",
};

/** 판매(허가~착공) vs 매입(준공·철거). */
export type SalesPlay = "sell" | "buy";

/**
 * 레코드의 영업 모드 — 매입(buy) vs 판매(sell).
 *  매입 = 나라장터 건물 철거·해체(고철·중고철근 발생) + 민간 준공(남은 철근).
 *  그 외(허가·착공·낙찰 신축·고시 선점) = 판매.
 */
export function salesMode(p: {
  source: RadarSource;
  usage: string | null;
  stage: RadarStage;
}): SalesPlay {
  if (p.usage === "demolition") return "buy";
  if (p.source === "building_permit" && p.stage === "completed") return "buy";
  return "sell";
}

/** 민간 보드 컬럼 (라이프사이클 단계). */
export type BoardColumn = "permit" | "imminent" | "construction" | "completed";

/** 민간 레코드 → 보드 컬럼. 허가+착공예정 잡힘=견적, 허가만=선점. */
export function boardColumn(p: {
  stage: RadarStage;
  sched_start_date: string | null;
  start_date: string | null;
}): BoardColumn {
  if (p.stage === "completed") return "completed"; // 준공 = 매입
  if (p.stage === "construction_start") return "construction"; // 착공 = 납품
  if (p.sched_start_date && !p.start_date) return "imminent"; // 허가+착공예정 = 견적
  return "permit"; // 허가만 = 선점
}

export const BOARD_COLUMNS: Array<{
  key: BoardColumn;
  label: string;
  sub: string;
  play: SalesPlay;
  className: string;
}> = [
  {
    key: "permit",
    label: "① 허가·선점",
    sub: "관계구축",
    play: "sell",
    className: "border-zinc-400/40 bg-zinc-50 dark:bg-zinc-900/40",
  },
  {
    key: "imminent",
    label: "② 착공임박·견적",
    sub: "견적 타이밍",
    play: "sell",
    className: "border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/30",
  },
  {
    key: "construction",
    label: "③ 착공·납품 💰",
    sub: "지금 납품",
    play: "sell",
    className: "border-red-500/40 bg-red-50/60 dark:bg-red-950/30",
  },
  {
    key: "completed",
    label: "④ 준공·매입 💰",
    sub: "남은 철근",
    play: "buy",
    className: "border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/30",
  },
];

/** 용도 카테고리 표시 라벨 (점수 키 → 한글). config.USAGE_SCORE 키와 동일 집합. */
export const USAGE_LABEL: Record<string, string> = {
  factory: "공장",
  warehouse: "창고",
  neighborhood: "근린생활",
  multi_family: "다세대·다가구",
  apartment: "공동주택",
  education: "교육",
  etc: "기타",
  // 관급(나라장터) 공종 카테고리
  building: "건축",
  building_reno: "건축·보수", // 건물 리모델링·보수·기능보강(신축 아님)
  civil_struct: "구조토목",
  civil_low: "토목",
  demolition: "철거·해체", // 매입 신호(고철·중고철근 발생)
  // 시청 고시(선점) 카테고리
  industrial_complex: "산업단지",
  redevelopment: "정비·개발",
  large_building: "대형건축",
  road: "도로",
  infra: "인프라",
};

// ── 관련성 등급 — 핸드오프 §6 (A=코랄, B=앰버, C=그레이) ───────
export const RELEVANCE_GRADES = ["A", "B", "C"] as const;
export type RelevanceGrade = (typeof RELEVANCE_GRADES)[number];

export const RELEVANCE_GRADE_META: Record<
  RelevanceGrade,
  { label: string; className: string; pin: string }
> = {
  A: {
    label: "A",
    className: "border-rose-500/40 bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
    pin: "#fb7185", // 코랄 (지도 핀)
  },
  B: {
    label: "B",
    className:
      "border-amber-500/40 bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    pin: "#f59e0b", // 앰버
  },
  C: {
    label: "C",
    className: "border-zinc-400/40 bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300",
    pin: "#9ca3af", // 그레이
  },
};

// ── 데이터 흐름 타입 ──────────────────────────────────────────

/**
 * 어댑터(collector)가 뱉는 정규화 결과 — 점수·좌표 계산 전.
 * 모든 소스 어댑터는 이 형태의 배열을 반환한다(확장 시 동일 계약).
 */
export interface CollectedProject {
  source: RadarSource;
  source_key: string; // 소스 자연키 (허가대장PK or 공고번호)
  region: RadarRegion;
  sigungu_code: string | null;
  project_type: ProjectType;
  title: string;
  address: string | null;
  usage: string | null; // 정규화 용도 카테고리 키 (config.USAGE_SCORE 키)
  structure: StructureType | null;
  floor_area: number | null; // ㎡
  stage: RadarStage;
  stage_date: string | null; // ISO date (YYYY-MM-DD) — 현재 단계 기준일
  // 라이프사이클 날짜 (민간; 관급은 null) — 카드 타임라인·보드 컬럼용
  permit_date: string | null; //      건축허가일 (선점)
  sched_start_date: string | null; // 착공예정일 (견적)
  start_date: string | null; //       실착공일   (납품)
  completion_date: string | null; //  사용승인일 (매입)
  ordering_org: string | null; // 발주처 (관급, 표시용 — 연락 대상 아님)
  contact_party: string | null; // 연락 주체 (민간: 건축주/시공사, 관급: 낙찰사)
  awarded_company: string | null; // 낙찰사명 (관급, 낙찰 후)
  est_amount: number | null; // 추정가격/기초금액 (관급)
  source_url?: string | null; // 고시/공고 원문 링크 (notice 등)
  raw: unknown; // 원시 응답 (디버깅·재처리)
}

/** 점수 엔진이 채우는 필드. */
export interface ScoredFields {
  relevance_score: number; // 0~100
  relevance_grade: RelevanceGrade;
  est_rebar_ton: number | null; // 추정 철근/강관 톤
}

/** 지오코딩이 채우는 필드 (phase 1.5 — 키 도착 후). */
export interface GeoFields {
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
}

/** upsert 직전의 완성 레코드. */
export type UpsertableProject = CollectedProject & ScoredFields & Partial<GeoFields>;

/**
 * DB(construction_project) 행 — UI 조회 결과 형태(raw 제외).
 * 점수 컬럼은 미수집/미점수 행 대비 nullable.
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
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  usage: string | null;
  structure: StructureType | null;
  floor_area: number | null;
  est_rebar_ton: number | null;
  stage: RadarStage;
  stage_date: string | null;
  permit_date: string | null;
  sched_start_date: string | null;
  start_date: string | null;
  completion_date: string | null;
  ordering_org: string | null;
  contact_party: string | null;
  awarded_company: string | null;
  relevance_grade: RelevanceGrade | null;
  relevance_score: number | null;
  est_amount: number | null;
  source_url: string | null;
  linked_partner_id: string | null;
  created_at: string; // = 최초 수집(first seen)
  updated_at: string; // = 최종 갱신
}
