/**
 * 발주 레이더 설정값 — 권역·법정동(건축HUB 수집 단위)·차고지.
 *
 * v2(2026-10): 점수 계수·등급 임계·추정톤 계수는 폐기(docs/발주_레이더_v2_기획.md §10).
 * 민간 수집은 운영상 경주만 돌린다(RADAR_REGIONS=gyeongju, radar-building.yml) — 포항·울산 정의는
 * 관급 권역 판정·기존 행 보존을 위해 남긴다.
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
 * 차고지(거리 계산 기준점) — 지오코딩·거리 정렬은 v2 '추후'(리스트 4주 사용 후).
 * 실제 본사: 경상북도 경주시 태종로 263-32(충효동, company_profile). 좌표는 지오코딩 도입 시 채운다.
 */
export const GARAGE = {
  label: "신라철강 본사(충효동) — 좌표 미입력",
  address: "경상북도 경주시 태종로 263-32",
  lat: null as number | null,
  lng: null as number | null,
} as const;
