/**
 * 발주 레이더 v2 화면 노출 규칙 — 순수함수.
 *
 * 화면(/radar)·CSV 내보내기(radar-v2-export)·측정(radar-v2-measure)·정리(radar-v2-cleanup)·수집 알림이
 * 같은 함수를 쓴다. 부수효과 없음(테스트: scripts/radar-v2-check.ts).
 * 기획안 §4.2(규칙)·§4.3(행 계약)·§5(상태)·§6(결과 코드) — docs/발주_레이더_v2_기획.md
 */

import { addrRegion, naraLabel, telValid, NON_STEEL_NAME } from "./nara-rules";
import type { RadarRegion, RadarSource, RadarStage } from "./types";

// ── 창·임계값(기획안 §4.2, 사용자 확정 2026-10-06) ─────────────
/** 방문 탭: '단계 반영일(stage_changed_at)' 기준 60일. 허가·착공일 기준 창도, 시드/운영 구분도 없다. */
export const VISIT_WINDOW_DAYS = 60;
/** 전화 탭 A: 경주 소재 낙찰사, 낙찰 30일. */
export const PHONE_WINDOW_LOCAL_DAYS = 30;
/** 전화 탭 B: RC 신축·구조물 낙찰, 3권역·소재지 무관, 90일. */
export const PHONE_WINDOW_RC_DAYS = 90;
/** 실납품 최소 현장 62㎡(북토리 1014). */
export const MIN_FLOOR_AREA_SQM = 60;
/** 레이더 51·33행, 매출 0 → 제외. */
export const EXCLUDE_EMD: ReadonlySet<string> = new Set(["감포읍", "북군동"]);

// ── 날짜 유틸(순수) ───────────────────────────────────────────
const MS_DAY = 86_400_000;
const toDate = (d: string | Date) => (d instanceof Date ? d : new Date(d));
/** today − d (일). d 없으면 null. */
export function daysSince(d: string | null | undefined, today: string | Date): number | null {
  if (!d) return null;
  const a = toDate(d).getTime();
  const b = toDate(today).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / MS_DAY);
}
/** YYYY-MM-DD + n일. */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Date → YYYY-MM-DD (로컬 KST 기준으로 쓰려면 호출부에서 맞춘다). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── 거리 밴드(읍면동 텍스트 — 지오코딩 전, km 표기 금지) ─────
export type DistanceBand = "near" | "mid" | "far";
export const DISTANCE_BANDS: readonly DistanceBand[] = ["near", "mid", "far"] as const;
export const BAND_LABEL: Record<DistanceBand, string> = { near: "근거리", mid: "중거리", far: "원거리" };
export const BAND_SUB: Record<DistanceBand, string> = {
  near: "시내 · 현곡 · 내남 · 건천 · 천북",
  mid: "안강 · 외동 · 강동 · 서면",
  far: "양남 · 문무대왕 · 산내",
};
const NEAR_EMD = new Set(["현곡면", "내남면", "건천읍", "천북면"]);
const MID_EMD = new Set(["안강읍", "외동읍", "강동면", "서면"]);
const FAR_EMD = new Set(["양남면", "문무대왕면", "양북면", "산내면"]); // 양북면 = 문무대왕면 구명(API 잔존)

/**
 * 주소(없으면 제목)에서 읍·면·동 토큰 추출. "경상북도 경주시 안강읍 안강리 88-14번지" → 안강읍,
 * "황성동 290-13" → 황성동. 못 찾으면 null.
 */
export function emdOf(address: string | null | undefined, title?: string | null): string | null {
  for (const s of [address, title]) {
    if (!s) continue;
    for (const tok of String(s).split(/\s+/)) {
      // 1글자+접미사(서면·평동·마동·율동·탑동…)도 읍면동이다. '{2,7}'은 이들을 놓쳐 근거리 현장을 중거리로 보냈다.
      if (/^[가-힣]{1,7}(읍|면|동)$/.test(tok) && !/(북도|남도)$/.test(tok)) return tok;
    }
  }
  return null;
}

/** 읍면동 → 밴드. 시내 '동'은 전부 근거리, 미지정 읍면은 중거리(보수). */
export function bandOf(emd: string | null): DistanceBand {
  if (!emd) return "mid";
  if (NEAR_EMD.has(emd) || emd.endsWith("동")) return "near";
  if (MID_EMD.has(emd)) return "mid";
  if (FAR_EMD.has(emd)) return "far";
  return "mid";
}

// ── 방문 탭(경주 민간 현장) ───────────────────────────────────
export interface VisitInput {
  source: RadarSource;
  region: RadarRegion;
  stage: RadarStage;
  floor_area: number | null;
  usage: string | null;
  address: string | null;
  title: string;
  /** raw.mainPurpsCdNm (주용도 원문) */
  main_purps?: string | null;
  /** raw.block (택지 블록) */
  block?: string | null;
}

/** 택지 일괄 착공(울주 서생면 블록 등). 경주는 15행. */
export function isBlock(p: Pick<VisitInput, "block" | "address" | "title">): boolean {
  if ((p.block ?? "").trim() !== "") return true;
  return /블록|블럭/.test(`${p.address ?? ""} ${p.title ?? ""}`);
}

/**
 * 방문 행 정적 규칙(창·처분 제외). 규칙 B: usage≠etc ∨ ≥200㎡ ∨ 단독주택(하한 60㎡ 공통).
 * 창(stage_changed_at ≤ 60일)은 withinVisitWindow 로 — 기록이 있는 행은 창 밖이어도 남는다.
 */
export function visitRuleMatch(p: VisitInput): boolean {
  if (p.source !== "building_permit" || p.region !== "gyeongju") return false;
  if (p.stage !== "construction_start" && p.stage !== "permit") return false;
  if (isBlock(p)) return false;
  const area = p.floor_area ?? 0;
  if (area < MIN_FLOOR_AREA_SQM) return false;
  const ruleB =
    (p.usage != null && p.usage !== "etc") || area >= 200 || /단독주택/.test(p.main_purps ?? "");
  if (!ruleB) return false;
  const emd = emdOf(p.address, p.title);
  if (emd && EXCLUDE_EMD.has(emd)) return false;
  return true;
}

/**
 * 제목이 주소의 반복이 아니면 힌트("김중환씨 근생신축", "(주)태웅산업" 등)로 노출. 지번만 있는 제목은 힌트 아님.
 * 회사·개인명 힌트는 방문 행의 7/108 [확인] — '누구'의 기본값은 "미상 → 표지판 확인".
 */
export function titleHint(title: string | null | undefined, address: string | null | undefined): string | null {
  const t = (title ?? "").trim();
  const a = (address ?? "").trim();
  if (!t || !a) return null;
  if (t === a || a.includes(t) || t.includes(a)) return null;
  if (/^[가-힣]+(읍|면|동|리)?\s*(산)?[\d-]+(번지)?$/.test(t)) return null;
  return t;
}

/**
 * 방문 창 기준 시각 — stage_changed_at, 없으면 created_at(최초 수집).
 * stage_changed_at 은 v2 수집기·0070 기본값이 채우지만, 구 수집기로 들어온 행도 창에서 빠지지 않게 한다.
 */
export function effectiveStageTime(stage_changed_at: string | null, created_at: string | null): string | null {
  return stage_changed_at ?? created_at;
}

export function withinVisitWindow(stage_changed_at: string | null, today: string | Date): boolean {
  const n = daysSince(stage_changed_at, today);
  // today 가 "YYYY-MM-DD"(UTC 자정)이고 stage_changed_at 이 같은 날 KST 오전 동기화 시각이면 n = -1 → 당일 행도 창 안.
  return n != null && n >= -1 && n <= VISIT_WINDOW_DAYS;
}

// ── 전화 탭(관급 낙찰사 계정) ─────────────────────────────────
export interface PhoneInput {
  source: RadarSource;
  stage: RadarStage;
  stage_date: string | null;
  title: string;
  /** raw.mtltyAdvcPsblYnCnstwkNm(입찰공고 공사종류) — '유지보수공사'면 RC 아님 */
  cnstwk_type?: string | null;
  awarded_company: string | null;
  /** raw.bidwinnrTelNo */
  awardee_tel?: string | null;
  /** raw.bidwinnrAdrs */
  awardee_addr?: string | null;
}
export type PhoneMatch = "local" | "rc" | "both";

/**
 * 전화 행 규칙. A(local)=경주 소재 낙찰사 30일 · B(rc)=RC 라벨 90일. 둘 다 아니면 null.
 * 전화 마스킹·비철근 사명·비철근 공종 제목은 제외(삭제 아님, 화면 제외).
 */
export function phoneRuleMatch(p: PhoneInput, today: string | Date): PhoneMatch | null {
  if (p.source !== "nara_bid" || p.stage !== "awarded") return null;
  if (!telValid(p.awardee_tel)) return null;
  if (NON_STEEL_NAME.test(p.awarded_company ?? "")) return null;
  // 라벨은 저장된 usage가 아니라 읽는 시점에 제목·공사종류로 계산 — 라벨 재계산·구 수집기 덮어쓰기와 무관하게 같은 결과.
  const label = naraLabel(p.title, p.cnstwk_type ?? null);
  if (label === null || label === "non_steel") return null; // 비공사 · 비철근 공종(소방·전기…)·작업(숲가꾸기·포장·준설…)
  const n = daysSince(p.stage_date, today);
  if (n == null || n < 0) return null;
  const local = addrRegion(p.awardee_addr) === "gyeongju" && n <= PHONE_WINDOW_LOCAL_DAYS;
  const rc = label === "rc" && n <= PHONE_WINDOW_RC_DAYS;
  if (local && rc) return "both";
  if (local) return "local";
  if (rc) return "rc";
  return null;
}

/** 관급 라벨(rc·civil·non_steel·null=비공사)을 제목·공사종류로 계산 — 저장된 usage 대신 쓴다. */
export function naraLabelOf(title: string, cnstwkType: string | null | undefined) {
  return naraLabel(title, cnstwkType ?? null);
}

// ── 상태(저장 안 함, 파생) — 기획안 §5 ────────────────────────
export type RowStatus = "today" | "waiting" | "done";
export const STATUS_LABEL: Record<RowStatus, string> = { today: "오늘", waiting: "대기", done: "완료" };

export interface TouchLog {
  created_at: string; // timestamptz
  contacted_on: string; // date
  follow_up_on: string | null;
  result: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
  channel?: string | null;
  prospect_name?: string | null; // radar_touch: 시공사·업체명(입력 시) 또는 주소
}

/**
 * 방문 기록에서 확보한 시공사·업체명 — radar_touch 는 prospect_name 에 '입력한 업체명 ?? 주소'를 넣으므로
 * 주소·제목과 다른 값만 업체명으로 본다(가장 최근 것).
 */
export function companyHintFromLogs(logs: TouchLog[], address: string | null, title: string | null): string | null {
  const same = (x: string) => {
    const a = (address ?? "").trim();
    const t = (title ?? "").trim();
    return x === a || x === t || (a !== "" && (a.includes(x) || x.includes(a)));
  };
  const sorted = [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const l of sorted) {
    const p = (l.prospect_name ?? "").trim();
    if (p && !same(p)) return p;
  }
  return null;
}

/** 다음 행동일 기본값(일) — 결과 코드 '견적 요청'·'다음에' 공통. 기한 없는 기록도 이 날짜에 다시 '오늘'로 온다. */
export const DEFAULT_FOLLOW_UP_DAYS = 7;

export const RESULT_REFUSED = "철근 안 씀·거절";
export const RESULT_UNREACHABLE = "현장 없음·연락 불가·폐업";
/**
 * 결과 문구 정규화 — 영업내역 페이지에 손으로 적은 결과(자유 텍스트)도 4코드로 읽는다. SQL radar_is_refusal(0072)과 같은 규칙.
 *  1) 공백·가운뎃점 변형을 지운 뒤 4코드와 정확히 같으면 그 코드(문서·CSV 안내 형식).
 *  2) 거절·거부·연락 말라 = 수신거부(보수적). 단 부정·번복('거절 안 함'·'미거절'·'거절했다가 다시 요청')은 제외.
 *  3) 부재·재통화·통화중·안 받음·약속 = '다음에' — '부재중, 연락불가' 같은 일시 부재가 연락 불가(제외)로 가지 않게 먼저.
 *  4) 견적 = '견적 요청'. 5) 현장 없음·폐업·결번·없는 번호·연락 불가 = 연락 불가(제외, 복구 가능).
 */
const RESULT_EXACT: Record<string, string> = {
  견적요청: "견적 요청",
  다음에: "다음에",
  철근안씀거절: RESULT_REFUSED,
  현장없음연락불가폐업: RESULT_UNREACHABLE,
};
export function normalizeResultCode(text: string | null | undefined): string | null {
  const t = String(text ?? "").replace(/[\s·ㆍ.・]/g, "");
  if (!t) return null;
  if (RESULT_EXACT[t]) return RESULT_EXACT[t];
  if (/철근안씀|거절|거부|연락(하지)?마|연락말/.test(t) && !/(거절|거부)(안|아님|없|x|X)|미거절|했다가/.test(t)) return RESULT_REFUSED;
  if (/다음에|부재|재통화|통화중|안받|담당자|약속/.test(t)) return "다음에";
  if (/견적/.test(t)) return "견적 요청";
  if (/현장없음|폐업|결번|없는번호|연락불가/.test(t)) return RESULT_UNREACHABLE;
  return null;
}
export const isDismissResult = (text: string | null | undefined) => {
  const c = normalizeResultCode(text);
  return c === RESULT_REFUSED || c === RESULT_UNREACHABLE;
};

/**
 * 오늘 = 미접촉 ∨ 다음 행동일 ≤ 오늘 ∨ 기록 뒤 단계 변경 ∨ 최신 기록이 제외 결과인데 제외돼 있지 않음([복구]한 행).
 * 대기 = 다음 행동일 > 오늘. 완료 = dismissed_at 있음(제외)만.
 * 다음 행동일이 비어 있으면(영업내역 페이지 수기 기록 등) 접촉일 + 7일 — '기한 없는 대기'로 영구 체류하지 않게.
 * (수기 '거절'·'현장 없음' 기록은 linkSalesLogNotes 가 연결하며 제외 처리하므로 완료로 간다.)
 */
export function deriveStatus(
  input: { dismissed_at: string | null; stage_changed_at: string | null; logs: TouchLog[] },
  today: string,
): RowStatus {
  if (input.dismissed_at) return "done";
  if (input.logs.length === 0) return "today";
  const latest = input.logs.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
  const code = normalizeResultCode(latest.result);
  if (code === RESULT_REFUSED) return "done"; // 거절 기록 = 수신거부(제외 처리 전이어도 완료 — 복구·재기록 불가)
  if (code === RESULT_UNREACHABLE) return "today"; // 연락 불가인데 제외 안 됨 = [복구]한 행 → 다시 할 일
  if (input.stage_changed_at && input.stage_changed_at > latest.created_at) return "today";
  const due = latest.follow_up_on ?? (latest.contacted_on ? addDays(latest.contacted_on, DEFAULT_FOLLOW_UP_DAYS) : null);
  if (due && due <= today) return "today";
  return "waiting";
}

// ── 결과 코드(고정 4종)·제외 사유(3종) — 기획안 §6 ─────────────
export interface ResultCode {
  code: string;
  /** 다음 행동일 기본값(일). null = 즉시 완료(제외). */
  followUpDays: number | null;
  /** 이 결과가 만드는 제외 사유. null = 제외 아님. */
  dismissReason: string | null;
  hint: string;
}
export const RESULT_CODES: readonly ResultCode[] = [
  { code: "견적 요청", followUpDays: DEFAULT_FOLLOW_UP_DAYS, dismissReason: null, hint: "견적을 달라고 함 → 견적 작성" },
  { code: "다음에", followUpDays: DEFAULT_FOLLOW_UP_DAYS, dismissReason: null, hint: "담당자 확보·재통화/방문 약속·부재 포함" },
  { code: RESULT_REFUSED, followUpDays: null, dismissReason: RESULT_REFUSED, hint: "영구 숨김(복구 없음)" },
  { code: RESULT_UNREACHABLE, followUpDays: null, dismissReason: RESULT_UNREACHABLE, hint: "완료로 이동(복구 가능)" },
] as const;
export const RESULT_CODE_VALUES = RESULT_CODES.map((r) => r.code);

export const DISMISS_REASONS = ["철근 안 씀·거절", "현장 없음·연락 불가·폐업", "기타"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
/** 수신거부 보장 — 복구 버튼 없음. */
export const PERMANENT_DISMISS_REASON: DismissReason = RESULT_REFUSED;

/**
 * 영업내역 메모에서 레이더 행 id 추출 — '레이더' 바로 뒤(구분자·라벨 12자 이내)의 UUID 우선
 * ("레이더 {id}", "레이더 id: {id}", "레이더 - {id}"), 없으면 메모 안 UUID 가 딱 하나일 때만 그것.
 */
const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export function extractRadarId(notes: string | null | undefined): string | null {
  const s = String(notes ?? "");
  if (!s.includes("레이더")) return null;
  const near = s.match(new RegExp(`레이더[^0-9a-f]{0,12}(${UUID_SRC})`, "i"));
  if (near) return near[1].toLowerCase();
  const all = s.match(new RegExp(UUID_SRC, "gi")) ?? [];
  return all.length === 1 ? all[0].toLowerCase() : null;
}

/** 발주 레이더 v2 콜·방문 캠페인 시작일(KST, 기획안 D0) — 판정 집계 기본값·문자 가드 기준. */
export const RADAR_CAMPAIGN_START = "2026-10-07";

/**
 * 출처(partner.source_project_id) 없는 ★ 거래처가 ★ 행이 처음 수집되기 전에 등록됐는가 — 그 뒤에 등록된 거래처
 * (전화 캠페인 뒤 거래처 메뉴 등록, 명함 등록 뒤 [거래처로] 연결 등)는 레이더가 먼저 안 상대라 false.
 * 날짜가 없거나 깨져도 false(보수적).
 */
export function registeredBeforeRadar(
  partnerCreatedAt: string | null | undefined,
  rowCreatedAts: Array<string | null | undefined>,
): boolean {
  const registered = Date.parse(String(partnerCreatedAt ?? ""));
  if (!Number.isFinite(registered) || rowCreatedAts.length === 0) return false;
  let firstSeen = Infinity;
  for (const c of rowCreatedAts) {
    const t = Date.parse(String(c ?? ""));
    if (!Number.isFinite(t)) return false;
    if (t < firstSeen) firstSeen = t;
  }
  return registered < firstSeen;
}

/**
 * 문자 가드용 '레이더 이전부터' 거래처 — 캠페인 시작 전에, 그리고 ★ 행이 처음 수집되기 전에 등록된 곳만 true.
 * 캠페인 중 등록된 거래처는 ★ 행 시각과 무관하게 레이더 유래로 본다(처음 연락한 행은 연결되지 않고 나중 행만 연결돼도 새지 않게).
 */
export function preRadarPartner(
  partnerCreatedAt: string | null | undefined,
  rowCreatedAts: Array<string | null | undefined>,
  campaignStart: string = RADAR_CAMPAIGN_START,
): boolean {
  if (!registeredBeforeRadar(partnerCreatedAt, rowCreatedAts)) return false;
  return Date.parse(String(partnerCreatedAt)) < Date.parse(`${campaignStart}T00:00:00+09:00`);
}

export function resultCodeOf(code: string | null | undefined): ResultCode | null {
  return RESULT_CODES.find((r) => r.code === code) ?? null;
}
/** 결과 코드 → 다음 행동일 기본값(today 기준). 제외 코드는 null. */
export function defaultFollowUp(code: string, today: string): string | null {
  const r = resultCodeOf(code);
  if (!r || r.followUpDays == null) return null;
  return addDays(today, r.followUpDays);
}
