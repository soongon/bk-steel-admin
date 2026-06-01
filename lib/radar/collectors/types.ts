/**
 * 수집 어댑터 계약(adapter contract).
 *
 * 모든 소스 어댑터는 동일한 출력형(CollectedProject[])을 뱉는다.
 * 새 소스(예: 민간 누리장터, 정비사업 고시) 추가 = 이 인터페이스를 구현한
 * 어댑터 파일 하나를 만들고 collectors/index 의 COLLECTORS 배열에 등록.
 */

import type { CollectedProject, RadarRegion, RadarSource } from "../types";

export interface CollectContext {
  /** 최근 N일 내 갱신분만 수집(소스가 날짜 필터를 지원할 때). */
  sinceDays: number;
  /** 권역(시군구)당 페이지 행수 상한 — 개발계정 트래픽 보호. */
  maxRowsPerRegion?: number;
  /**
   * 건축인허가: active 판정 기간(일). 준공(completed) 제외 + stage_date가 이 기간 내인 건만 수집.
   * (API에 날짜 파라미터·정렬이 없어 전체 페이징 후 클라이언트에서 거른다.) 기본 730.
   */
  activeWindowDays?: number;
  /** 법정동당 최대 페이지(테스트·throttle). 기본 무제한. */
  maxPagesPerBjdong?: number;
  /** 시군구당 법정동 수 제한(테스트·throttle). 기본 전체. */
  maxBjdongPerSigungu?: number;
  /** 특정 권역만 수집(부분 sync·테스트). 미지정=전체. */
  regions?: RadarRegion[];
  /** 관급(나라장터): 최근 N일 입찰공고/낙찰 수집(≤28일씩 청크). 기본 30. */
  naraWindowDays?: number;
}

export interface Collector {
  source: RadarSource;
  label: string;
  /** 환경변수 키가 없으면 [] 반환(무해). 정규화된 CollectedProject[] 반환. */
  collect(ctx: CollectContext): Promise<CollectedProject[]>;
}
