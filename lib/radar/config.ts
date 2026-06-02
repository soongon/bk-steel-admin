/**
 * 발주 레이더 설정값 — 지역·차고지·점수 계수.
 *
 * ⚠️ 이 파일의 값은 전부 "초안"이다.
 * 핸드오프 §9 — 시군구코드·차고지 좌표·점수 계수·임계값·납품 반경은
 * 모두 사용자 승인 / 실거래 보정 대상이다. 계수 하드코딩 금지 원칙에 따라
 * 점수·추정에 쓰이는 모든 숫자를 이 한 파일로 분리했다(보정 단일 지점).
 */

import type { RadarRegion } from "./types";
import { BJDONG_CODES } from "./bjdong-codes";

export interface SigunguConfig {
  code: string; // 시군구코드 5자리
  label: string;
  /**
   * 건축인허가 API 필수 파라미터 bjdongCd(법정동 5자리) 목록. (실호출 검증 결과 sigunguCd만으론
   * 빈 응답 → 법정동 단위 순회 필수.) 비어 있으면 해당 시군구 수집을 건너뛴다.
   */
  bjdongCodes: string[];
}

export interface RegionConfig {
  region: RadarRegion;
  label: string;
  /** 나라장터 지역 1차 필터용 시도명. */
  province: "경상북도" | "울산광역시";
  sigungu: SigunguConfig[];
}

/**
 * 권역 정의. 지역/시군구 추가는 이 배열에 항목 추가로 끝난다(확장성).
 * 법정동코드(bjdongCodes)는 공식 전체자료에서 생성 — scripts/radar-gen-bjdong.ts → bjdong-codes.ts.
 * (건축인허가 API가 bjdongCd 필수라 시군구당 동·읍면·리 전체 목록 필요.)
 */
export const REGIONS: RegionConfig[] = [
  {
    region: "gyeongju",
    label: "경주",
    province: "경상북도",
    sigungu: [{ code: "47130", label: "경주시", bjdongCodes: BJDONG_CODES["47130"] }],
  },
  {
    region: "pohang",
    label: "포항",
    province: "경상북도",
    sigungu: [
      { code: "47111", label: "포항시 남구", bjdongCodes: BJDONG_CODES["47111"] },
      { code: "47113", label: "포항시 북구", bjdongCodes: BJDONG_CODES["47113"] },
    ],
  },
  {
    region: "ulsan",
    label: "울산",
    province: "울산광역시",
    sigungu: [
      { code: "31110", label: "울산 중구", bjdongCodes: BJDONG_CODES["31110"] },
      { code: "31140", label: "울산 남구", bjdongCodes: BJDONG_CODES["31140"] },
      { code: "31170", label: "울산 동구", bjdongCodes: BJDONG_CODES["31170"] },
      { code: "31200", label: "울산 북구", bjdongCodes: BJDONG_CODES["31200"] },
      { code: "31710", label: "울주군", bjdongCodes: BJDONG_CODES["31710"] },
    ],
  },
];

/** 시군구코드 → 권역 역인덱스 (수집 시 권역 판정). */
export const SIGUNGU_TO_REGION: Record<string, RadarRegion> = Object.fromEntries(
  REGIONS.flatMap((r) => r.sigungu.map((s) => [s.code, r.region] as const)),
);

/**
 * 차고지(거리 계산 기준점).
 * TODO(필수): 사용자 실제 위경도 제공 전까지 경주시청 좌표 임시값.
 */
export const GARAGE = {
  label: "경주 차고지(임시)",
  lat: 35.8562,
  lng: 129.2247,
} as const;

/**
 * 점수 가중치 — 합 100. 핸드오프 §6 (구조·용도·연면적·거리).
 * TODO(보정): 실거래 데이터로 캘리브레이션.
 */
export const SCORE_WEIGHTS = {
  usage: 35,
  structure: 20,
  floorArea: 25,
  distance: 20,
} as const;

/** A/B/C 컷(0~100). TODO(승인). */
export const GRADE_THRESHOLDS = { A: 65, B: 45 } as const;

/**
 * 용도 점수(0~1, 음수=감산/제외). 스윗스팟 가산 / 대단지 아파트 감산.
 * 키는 정규화된 용도 카테고리(어댑터의 normalizeUsage 결과).
 */
export const USAGE_SCORE: Record<string, number> = {
  factory: 1.0, //       공장 — 직납 스윗스팟
  warehouse: 1.0, //     창고
  neighborhood: 0.8, //  근린생활시설
  multi_family: 0.7, //  다세대/다가구
  education: 0.5, //     교육
  apartment: -0.5, //    대단지 아파트 — 제강사 직납이라 소규모 유통 진입 어려움
  etc: 0.3, //           기타
};

/** 구조 점수(0~1). RC=철근 다발, steel=강관·형강 — 둘 다 우리 품목. */
export const STRUCTURE_SCORE: Record<string, number> = {
  RC: 1.0,
  steel: 0.9,
  etc: 0.4,
};

/** 연면적 정규화 기준(㎡). 이 면적에서 areaScore가 1로 포화. */
export const FLOOR_AREA_REF_SQM = 3000;

/**
 * 거리 점수 임계(km) — 차고지 크레인트럭 납품 반경.
 * full 이내=1, zero 밖=0, 사이는 선형 감산.
 * TODO(결정): 사용자 납품 반경 기준.
 */
export const DISTANCE = {
  full: 15,
  zero: 60,
} as const;

/**
 * ㎡당 철근 kg 계수(추정 철근톤). 핸드오프 §6 — 보수적 시작(50~90 범위).
 * TODO(보정): 용도별·실거래 캘리브레이션. 화면엔 항상 "약 ○톤"으로 표기.
 */
export const REBAR_KG_PER_SQM: Record<string, number> = {
  factory: 55,
  warehouse: 50,
  neighborhood: 70,
  multi_family: 75,
  apartment: 85,
  education: 80,
  etc: 60,
};

/** 철골(steel) 강관·형강 kg/㎡ 계수. */
export const STEEL_KG_PER_SQM = 45;

// ── 관급(나라장터) 철근관련성 — 공종 카테고리 + 낙찰금액 ──────────
/** 공종 카테고리 점수(0~1). 건축=철근 多 / 구조토목=中 / 일반토목=弱. (제외는 수집 단계에서 컷) */
export const NARA_CATEGORY_SCORE: Record<string, number> = {
  building: 1.0,
  civil_struct: 0.6,
  civil_low: 0.2,
};
/** 관급 가중치(합 100). 거리는 좌표 없어 제외. */
export const NARA_WEIGHTS = { category: 60, amount: 40 } as const;
/** 낙찰금액/추정가격(원) → 규모 점수. [임계≥, 점수] 내림차순. TODO(보정). */
export const NARA_AMOUNT_TIERS: Array<[number, number]> = [
  [10_000_000_000, 1.0], // 100억+
  [2_000_000_000, 0.8], //   20억+
  [500_000_000, 0.5], //      5억+
  [0, 0.2],
];

// ── 시청 고시(선점) 철근관련성 — 카테고리별 ──────────────────
/** 고시 카테고리 점수(0~1). 산단·물류=최대(대형 철근 선행), 도로·인프라=중. */
export const NOTICE_CATEGORY_SCORE: Record<string, number> = {
  industrial_complex: 1.0, // 산업단지·물류단지 — 대형 철근 선행
  redevelopment: 0.85, //    정비·재개발·도시개발·택지
  large_building: 0.8, //    대형건축 심의
  road: 0.5, //              도로(옹벽·구조물)
  infra: 0.5, //             도시계획시설·펌프장 등
  etc: 0.3,
};
