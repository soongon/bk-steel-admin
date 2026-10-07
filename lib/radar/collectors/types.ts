/**
 * 수집 어댑터 계약(adapter contract).
 *
 * 모든 소스 어댑터는 동일한 출력형(CollectedProject[])을 뱉는다.
 * 새 소스 추가 = 이 인터페이스를 구현한
 * 어댑터 파일 하나를 만들고 collectors/index 의 COLLECTORS 배열에 등록.
 */

import type { CollectedProject, RadarRegion, RadarSource } from "../types";

/** DB에 이미 있는 관급 행(공고번호 기준) — 공고가 수집 창 밖인 낙찰의 권역·공고 raw 판정용. */
export interface ExistingNaraRow {
  region: RadarRegion | null;
  raw: Record<string, unknown> | null;
  deleted: boolean;
}

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
  /** 특정 소스만 실행(building_permit | nara_bid). 미지정=전체. */
  sources?: RadarSource[];
  /**
   * 민간: 준공 행 수집 유지 기간(일). 기본 180. 신규 준공 행은 upsert 단계에서 skip 되고,
   * 이미 있는 행의 허가/착공→준공 전환(리스트 이탈)만 반영된다.
   */
  buybackWindowDays?: number;
  /**
   * 수집 실패 보고(창·법정동 단위). 진입 스크립트가 모아 cron 을 실패 처리·알림한다 —
   * 어댑터는 부분 실패에도 계속 진행하므로 이 콜백이 없으면 장애가 '성공 0건'으로 묻힌다.
   */
  onError?: (source: RadarSource, message: string) => void;
  /** (관급) 공고번호 → DB 기존 행. 주입 안 하면(dry-run) 제목·발주처만으로 판정. */
  existingNaraByKey?: (keys: string[]) => Promise<Map<string, ExistingNaraRow>>;
}

export interface Collector {
  source: RadarSource;
  label: string;
  /** 환경변수 키가 없으면 [] 반환(무해). 정규화된 CollectedProject[] 반환. */
  collect(ctx: CollectContext): Promise<CollectedProject[]>;
}
