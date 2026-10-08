/**
 * 발주 레이더 v2 규칙 검증 — 의존성 없는 순수 함수 단언.
 * 실행: `npm run radar:check` (= npx tsx scripts/radar-v2-check.ts)
 *
 * 정식 테스트 러너(vitest/jest)가 레포에 없어, tsx로 바로 도는 assert 스크립트로 둔다.
 * 대상: nara-rules(권역·라벨·RC) · v2-rules(방문/전화 규칙·밴드·상태·결과 코드) · collectors/index(병합·화이트리스트)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePartnerName } from "../lib/partner";
import { isExactQuoteRequest, isRefusalForMms } from "../lib/radar/radar-data";
import {
  matchRegionV2,
  regionFromText,
  regionSuspect,
  naraLabel,
  isRcTitle,
  hasNonSteelTrade,
  telValid,
  phoneKey,
  phoneMatches,
  addrRegion,
  otherPlaceIn,
} from "../lib/radar/nara-rules";
import {
  emdOf,
  titleHint,
  bandOf,
  isBlock,
  visitRuleMatch,
  withinVisitWindow,
  phoneRuleMatch,
  deriveStatus,
  defaultFollowUp,
  addDays,
  RESULT_CODES,
  DISMISS_REASONS,
  normalizeResultCode,
  extractRadarId,
  companyHintFromLogs,
  registeredBeforeRadar,
  preRadarPartner,
  type VisitInput,
  type PhoneInput,
} from "../lib/radar/v2-rules";
import {
  mergeWithExisting,
  toUpsertPayload,
  UPSERT_COLUMNS,
  HUMAN_COLUMNS,
} from "../lib/radar/collectors/index";
import { normalizeAward, normalizeBid, joinFromExisting } from "../lib/radar/collectors/naraBid";
import type { CollectedProject } from "../lib/radar/types";
import { csvCell } from "../lib/radar/csv";
import { buildVisitRows, type VisitSourceRow } from "../lib/radar/visit-view";
import { hiddenByTouches } from "../lib/radar/radar-data";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("── 권역 판정(matchRegionV2) ──");
check("'울주'⊂서울주택도시개발공사 → 울산 아님", () => {
  assert.equal(regionFromText("서울주택도시개발공사"), null);
  assert.equal(matchRegionV2({ title: "위례 A1 아파트 건설공사", orderingOrg: "서울주택도시개발공사" }), null);
});
check("'울주군'·'울산광역시'는 울산", () => {
  assert.equal(regionFromText("울산광역시 울주군"), "ulsan");
  assert.equal(regionFromText("울주군"), "ulsan");
});
check("붙여 쓴 포항 기관명(경상북도포항교육지원청·서포항농협·폴리텍대학포항)은 포항, 감포항은 경주", () => {
  assert.equal(regionFromText("경상북도교육청 경상북도포항교육지원청"), "pohang");
  assert.equal(regionFromText("서포항농업협동조합"), "pohang");
  assert.equal(regionFromText("한국폴리텍대학포항캠퍼스 내진보강 공사"), "pohang");
  assert.equal(regionFromText("구룡포초등학교 C동 철거공사"), "pohang");
  assert.equal(matchRegionV2({ siteRegion: "경상북도", title: "감포항 남측호안 보강공사", orderingOrg: "해양수산부 포항지방해양수산청" }), "gyeongju");
  assert.equal(regionFromText("청사포항 공중화장실"), null);
  assert.equal(regionFromText("서귀포항 정비"), null);
});
check("xx포항(삼천포항·다대포항)은 포항 아님, 구룡포항·영일만항·포항시는 포항", () => {
  assert.equal(regionFromText("삼천포항 준설공사"), null);
  assert.equal(regionFromText("다대포항 물양장"), null);
  assert.equal(regionFromText("구룡포항 해수교환시설"), "pohang");
  assert.equal(regionFromText("영일만항 배후도로"), "pohang");
  assert.equal(regionFromText("경상북도 포항시"), "pohang");
  assert.equal(regionFromText("(가칭)경상북도교육청 포항도서관 건립공사"), "pohang");
});
check("현장지역(cnstrtsiteRgnNm) 최우선 — 타 시군이면 발주처가 경주여도 null", () => {
  assert.equal(matchRegionV2({ siteRegion: "경상북도 경주시", title: "x", orderingOrg: "서울주택도시개발공사" }), "gyeongju");
  assert.equal(matchRegionV2({ siteRegion: "서울특별시", title: "x", orderingOrg: "경상북도 경주시" }), null);
  assert.equal(matchRegionV2({ siteRegion: "경상북도", title: "안강시장 노후시설 개보수", orderingOrg: "경상북도 경주시" }), "gyeongju");
});
check("광역 발주처(국토관리사무소·교육청 본청)는 제목 권역어 필수", () => {
  assert.equal(matchRegionV2({ title: "국도31호선 청송터널 방재시설 정비", orderingOrg: "국토교통부 부산지방국토관리청 포항국토관리사무소" }), null);
  assert.equal(matchRegionV2({ title: "국도4호선 토함산터널(경주) 방재시설", orderingOrg: "국토교통부 부산지방국토관리청 포항국토관리사무소" }), "gyeongju");
  assert.equal(matchRegionV2({ title: "학교 증축공사", orderingOrg: "경상북도교육청" }), null);
  assert.equal(matchRegionV2({ title: "학교 증축공사", orderingOrg: "경상북도교육청 경상북도경주교육지원청" }), "gyeongju");
});
check("제목에 타지역 지명 + 권역어 없음 → null", () => {
  assert.equal(matchRegionV2({ title: "통영고성지사 사옥 신축", orderingOrg: "국민건강보험공단 울산경남본부" }), null);
});
check("타지역 지명은 경계 매칭 — '공영주차장'⊃영주·'하동소하천'⊃하동·'고령자'⊃고령은 타지역 아님", () => {
  assert.equal(otherPlaceIn("2026년 공영주차장 환경개선사업"), null);
  assert.equal(otherPlaceIn("불국 하동소하천 소교량 개체공사"), null);
  assert.equal(otherPlaceIn("고령자 복지주택 건립"), null);
  assert.equal(otherPlaceIn("온산읍 행정복지타운 노상주차장 조성공사"), null);
  assert.equal(otherPlaceIn("위례지구 근린공원 유지관리"), "위례");
  assert.equal(otherPlaceIn("고덕 강일 공공주택"), "고덕");
  assert.equal(otherPlaceIn("부산항 북항 재개발"), "부산");
  assert.equal(otherPlaceIn("하동군 화개면 정비"), "하동");
});
check("권역 지자체 발주는 제목 토큰보다 우선 — 경주시 '하동소하천', 울산 남구 '공영주차장'", () => {
  assert.equal(matchRegionV2({ title: "불국 하동소하천 소교량 개체공사", orderingOrg: "경상북도 경주시" }), "gyeongju");
  assert.equal(matchRegionV2({ title: "2026년 공영주차장 환경개선사업", orderingOrg: "울산광역시 남구" }), "ulsan");
  assert.equal(matchRegionV2({ title: "하동 소하천 정비", orderingOrg: "경상북도 경주시" }), "gyeongju");
  assert.equal(matchRegionV2({ title: "서울주소방서 청사 신설 공사", orderingOrg: "울산광역시 소방본부" }), "ulsan");
  assert.equal(matchRegionV2({ title: "○○초 체육관 증축", orderingOrg: "울산광역시교육청" }), "ulsan");
  assert.equal(matchRegionV2({ title: "○○중 급식실 증축", orderingOrg: "경상북도교육청 경상북도포항교육지원청" }), "pohang");
});
check("regionSuspect: 현장지역이 권역이면 정상, 타 시군이면 의심", () => {
  assert.equal(regionSuspect({ title: "(긴급)경북대구낙농농협 효자지점 신축공사(실내건축)", ordering_org: "경북대구낙농협동조합" }, "경상북도 포항시 남구"), null);
  assert.ok(regionSuspect({ title: "공공주택 건설", ordering_org: "울산광역시" }, "서울특별시"));
  assert.ok(regionSuspect({ title: "다대포항 서방파제 보강공사", ordering_org: "부산항건설사무소" }));
});
check("정리용 regionSuspect — 기존 오판 행 포착", () => {
  assert.ok(regionSuspect({ title: "고덕 강일 공공주택", ordering_org: "서울주택도시개발공사" }));
  assert.ok(regionSuspect({ title: "삼천포항 준설", ordering_org: "경상남도 사천시" }));
  assert.equal(regionSuspect({ title: "구룡포항 해수교환시설 설치", ordering_org: "경상북도 포항시" }), null);
  assert.equal(regionSuspect({ title: "안강시장 노후시설 개보수사업", ordering_org: "경상북도 경주시" }), null);
});

console.log("── 공종 라벨(naraLabel) ──");
check("신축 소방공사는 non_steel('소방' 컷)", () => {
  assert.equal(naraLabel("동부캠퍼스 교육센터 신축 및 다목적운동장 구축 소방공사"), "non_steel");
  assert.equal(naraLabel("포항 경로당 신축공사(전기)"), "non_steel");
});
check("경로당 신축·소교량 개체는 rc", () => {
  assert.equal(naraLabel("중앙동 통양포 경로당 신축공사(건축)"), "rc");
  assert.equal(naraLabel("불국 하동소하천 소교량 개체공사"), "rc");
  assert.ok(isRcTitle("상북농공단지 복합문화센터 건립(건축)"));
});
check("정비·개보수·LED는 civil 또는 non_steel, rc 아님", () => {
  assert.equal(naraLabel("봉황로 문화의 거리 정비공사"), "civil");
  assert.equal(naraLabel("2026년 저소득층 LED조명 교체공사"), "non_steel");
  assert.equal(naraLabel("안강시장 노후시설 개보수사업"), "civil");
});
check("유지보수공사(공사종류)면 제목이 RC여도 rc 아님(라벨 입력, 컷 아님)", () => {
  assert.equal(naraLabel("마을회관 신축공사", "전문공사-유지보수공사"), "civil");
  assert.equal(naraLabel("마을회관 신축공사", "종합공사-신설공사"), "rc");
});
check("임대주택·설계시공 일괄은 공사(비공사 컷 예외), 순수 임대·설계용역은 비공사", () => {
  assert.equal(naraLabel("○○지구 공공임대주택 건설공사"), "rc");
  assert.equal(naraLabel("행복주택 건립공사"), "rc");
  assert.equal(naraLabel("○○센터 신축공사(설계·시공 일괄입찰)"), "rc");
  assert.equal(naraLabel("공유재산 임대"), null);
  assert.equal(naraLabel("체육관 신축 설계용역"), null);
});
check("비공사(설계·감리·용역)만 null(수집 컷)", () => {
  assert.equal(naraLabel("경주시청 신축 설계용역"), null);
  assert.equal(naraLabel("도서관 건립공사 감리"), null);
  assert.equal(naraLabel("산림환경연구 랩부스 설치"), "non_steel");
});
check("전화 유효성·소재지", () => {
  assert.ok(telValid("054-777-1234"));
  assert.ok(!telValid("***********"));
  assert.ok(!telValid("054-77"));
  assert.equal(addrRegion("경상북도 경주시 현곡면 안현로 54-13"), "gyeongju");
  assert.equal(addrRegion("경상북도 영천시 호국로 16"), "other");
  assert.ok(hasNonSteelTrade("정수장 성능회복 소방공사"));
});

console.log("── 수집기 정규화 ──");
check("normalizeBid: 현장지역 서울 → null, 경주 → bid_notice", () => {
  assert.equal(normalizeBid({ bidNtceNo: "R1", bidNtceNm: "공공주택 건설", cnstrtsiteRgnNm: "서울특별시", dminsttNm: "서울주택도시개발공사" }), null);
  const p = normalizeBid({ bidNtceNo: "R2", bidNtceNm: "안강시장 노후시설 개보수사업", cnstrtsiteRgnNm: "경상북도 경주시", dminsttNm: "경상북도 경주시", presmptPrce: "83890000", mtltyAdvcPsblYnCnstwkNm: "전문공사-유지보수공사" });
  assert.ok(p);
  assert.equal(p!.region, "gyeongju");
  assert.equal(p!.stage, "bid_notice");
  assert.equal(p!.usage, "civil");
  assert.equal(p!.est_amount, 83890000);
});
check("normalizeAward: 공고 조인 시 공고 권역·raw 병합, 단독이면 제목·지역 발주처", () => {
  const award = { bidNtceNo: "R3", bidNtceNm: "경로당 신축공사(건축)", dminsttNm: "경상북도 포항시", bidwinnrNm: "주식회사 덕산", bidwinnrTelNo: "054-000-0000", sucsfbidAmt: "240000000", fnlSucsfDate: "2026-09-09" };
  const joined = normalizeAward(award, { region: "pohang", raw: { cnstrtsiteRgnNm: "경상북도 포항시", mtltyAdvcPsblYnCnstwkNm: "종합공사-신설공사" } });
  assert.ok(joined);
  assert.equal(joined!.stage, "awarded");
  assert.equal(joined!.usage, "rc");
  assert.equal((joined!.raw as Record<string, unknown>).cnstrtsiteRgnNm, "경상북도 포항시");
  assert.equal((joined!.raw as Record<string, unknown>).bidwinnrNm, "주식회사 덕산");
  assert.equal(joined!.contact_party, "주식회사 덕산 · 054-000-0000");
  const alone = normalizeAward({ ...award, dminsttNm: "서울주택도시개발공사", bidNtceNm: "고덕 공공주택 건설" });
  assert.equal(alone, null);
});

check("낙찰 단독(공고 창 밖): DB 기존 공고 행의 현장지역으로 판정, 현장 타지역이면 적재 안 함", () => {
  const award = { bidNtceNo: "R10", bidNtceNm: "국도31호선 교량 재가설공사", dminsttNm: "국토교통부 부산지방국토관리청 포항국토관리사무소", bidwinnrNm: "OO건설(주)", bidwinnrTelNo: "054-000-0000", fnlSucsfDate: "2026-10-01" };
  assert.equal(normalizeAward(award), null); // 제목·발주처만으론 권역 미상
  const join = joinFromExisting({ region: "pohang", raw: { cnstrtsiteRgnNm: "경상북도 포항시", mtltyAdvcPsblYnCnstwkNm: "종합공사-신설공사" }, deleted: false });
  assert.ok(join && join !== "out");
  const p = normalizeAward(award, join as Exclude<typeof join, "out" | undefined>);
  assert.equal(p?.region, "pohang");
  assert.equal(p?.usage, "rc");
  assert.equal((p?.raw as Record<string, unknown>).cnstrtsiteRgnNm, "경상북도 포항시");
  assert.equal(joinFromExisting({ region: "ulsan", raw: { cnstrtsiteRgnNm: "서울특별시" }, deleted: false }), "out");
  assert.equal(joinFromExisting({ region: "ulsan", raw: {}, deleted: true }), undefined);
  assert.equal(joinFromExisting(undefined), undefined);
});

console.log("── 병합(mergeWithExisting)·화이트리스트 ──");
check("낙찰→입찰공고 역행 금지(창 교차·빈 낙찰 응답)", () => {
  const bid = normalizeBid({ bidNtceNo: "R9", bidNtceNm: "국도31호선 교량 재가설공사", cnstrtsiteRgnNm: "경상북도 포항시", dminsttNm: "포항국토관리사무소", bidNtceDt: "2026-09-07", presmptPrce: "500000000" })!;
  const ex = { source: "nara_bid", source_key: "R9", region: "pohang" as const, stage: "awarded", stage_changed_at: "2026-10-01T00:00:00Z", raw: { bidwinnrNm: "OO건설(주)" } };
  assert.equal(mergeWithExisting(bid, ex, "2026-10-07T00:00:00Z").kind, "skip_regress");
});
const base: CollectedProject = {
  source: "building_permit", source_key: "47130-1", region: "gyeongju", sigungu_code: "47130", project_type: "private",
  title: "황성동 290-13", address: "경상북도 경주시 황성동 290-13번지", usage: "neighborhood", structure: null, floor_area: 827,
  stage: "construction_start", stage_date: "2026-08-04", permit_date: "2026-06-01", sched_start_date: null, start_date: "2026-08-04",
  completion_date: null, ordering_org: null, contact_party: "건축주/시공사", awarded_company: null, est_amount: null, raw: { a: 1 },
};
check("신규 행은 stage_changed_at=last_seen_at=now, 점수 컬럼 null", () => {
  const m = mergeWithExisting(base, undefined, "2026-10-06T00:00:00Z");
  assert.equal(m.kind, "insert");
  if (m.kind === "insert") {
    assert.equal(m.row.stage_changed_at, "2026-10-06T00:00:00Z");
    assert.equal(m.row.last_seen_at, "2026-10-06T00:00:00Z");
    assert.equal(m.row.relevance_grade, null);
  }
});
check("신규 준공 행은 skip", () => {
  const m = mergeWithExisting({ ...base, stage: "completed" }, undefined, "2026-10-06T00:00:00Z");
  assert.equal(m.kind, "skip_new_completed");
});
check("같은 단계면 기존 stage_changed_at 유지, 단계 바뀌면 now · raw 병합 · 기존 region 유지", () => {
  const ex = { source: "building_permit", source_key: "47130-1", region: "gyeongju" as const, stage: "permit", stage_changed_at: "2026-08-15T00:00:00Z", raw: { b: 2, a: 0 } };
  const m = mergeWithExisting(base, ex, "2026-10-06T00:00:00Z");
  assert.equal(m.kind, "stage_change");
  if (m.kind === "stage_change") {
    assert.equal(m.row.stage_changed_at, "2026-10-06T00:00:00Z");
    assert.deepEqual(m.row.raw, { b: 2, a: 1 });
  }
  const same = mergeWithExisting(base, { ...ex, stage: "construction_start" }, "2026-10-06T00:00:00Z");
  assert.equal(same.kind, "update");
  if (same.kind === "update") assert.equal(same.row.stage_changed_at, "2026-08-15T00:00:00Z");
});
check("payload에 사람 컬럼·지오코딩 컬럼이 절대 없음", () => {
  for (const h of HUMAN_COLUMNS) assert.ok(!(UPSERT_COLUMNS as readonly string[]).includes(h), `${h} 가 화이트리스트에 있음`);
  const m = mergeWithExisting(base, undefined, "2026-10-06T00:00:00Z");
  if (m.kind === "insert") {
    const payload = toUpsertPayload({ ...m.row, dismissed_at: "x", linked_partner_id: "y" } as never);
    for (const h of HUMAN_COLUMNS) assert.ok(!(h in payload));
    assert.ok(!("created_at" in payload));
    assert.equal(payload.stage_changed_at, "2026-10-06T00:00:00Z");
  }
});

console.log("── 방문 탭 규칙 ──");
const v = (o: Partial<VisitInput>): VisitInput => ({
  source: "building_permit", region: "gyeongju", stage: "construction_start", floor_area: 300, usage: "neighborhood",
  address: "경상북도 경주시 황성동 290-13번지", title: "황성동 290-13", main_purps: "제2종근린생활시설", block: "", ...o,
});
check("읍면동 추출·밴드", () => {
  assert.equal(emdOf("경상북도 경주시 안강읍 안강리 88-14번지"), "안강읍");
  assert.equal(emdOf("황성동 290-13"), "황성동");
  assert.equal(emdOf("현곡면 남사리 436"), "현곡면");
  assert.equal(emdOf(null, "내남면 명계리 1842 공장"), "내남면");
  assert.equal(bandOf("황성동"), "near");
  assert.equal(bandOf("천북면"), "near");
  assert.equal(bandOf("외동읍"), "mid");
  assert.equal(bandOf("양남면"), "far");
  assert.equal(bandOf("양북면"), "far");
});
check("2글자 읍면동(서면·평동·마동·율동)도 추출 — 시내 동은 근거리, 서면은 중거리", () => {
  assert.equal(emdOf("경상북도 경주시 서면 아화리 1"), "서면");
  assert.equal(emdOf("경상북도 경주시 평동 918-2"), "평동");
  assert.equal(emdOf("경상북도 경주시 마동 산88"), "마동");
  assert.equal(emdOf("경상북도 경주시 율동 363-7번지"), "율동");
  assert.equal(bandOf("평동"), "near");
  assert.equal(bandOf("서면"), "mid");
  assert.equal(emdOf("경상북도 경주시"), null);
});
check("규칙 B: 근생 ≥60 통과, 단독주택 60~150 통과(하한 60), 비주택 etc 150 탈락", () => {
  assert.ok(visitRuleMatch(v({})));
  assert.ok(visitRuleMatch(v({ usage: "etc", floor_area: 99, main_purps: "단독주택" })));
  assert.ok(!visitRuleMatch(v({ usage: "etc", floor_area: 150, main_purps: "동물및식물관련시설" })));
  assert.ok(visitRuleMatch(v({ usage: "etc", floor_area: 250, main_purps: "동물및식물관련시설" })));
  assert.ok(!visitRuleMatch(v({ floor_area: 59 })));
});
check("제외: 감포읍·북군동·블록·준공·타권역·관급", () => {
  assert.ok(!visitRuleMatch(v({ address: "경상북도 경주시 감포읍 감포리 1" })));
  assert.ok(!visitRuleMatch(v({ address: "경상북도 경주시 북군동 10" })));
  assert.ok(!visitRuleMatch(v({ block: "R6" })));
  assert.ok(!visitRuleMatch(v({ address: "울산광역시 울주군 서생면 신암리 블록" })));
  assert.ok(!visitRuleMatch(v({ stage: "completed" })));
  assert.ok(!visitRuleMatch(v({ region: "ulsan" })));
  assert.ok(!visitRuleMatch(v({ source: "nara_bid" })));
  assert.ok(isBlock({ block: "", address: "서생면 신암리 블록", title: "x" }));
});
check("제목 힌트: 지번·주소 반복은 null, 회사·개인명만", () => {
  assert.equal(titleHint("현곡면 남사리 436", "경상북도 경주시 현곡면 남사리 436번지"), null);
  assert.equal(titleHint("노서동 31-11", "경상북도 경주시 노서동 31-11번지"), null);
  assert.equal(titleHint("천군동 산310-8", "경상북도 경주시 천군동 산310-8번지"), null);
  assert.equal(titleHint("온양읍 내광리 김중환씨 근생신축", "울산광역시 울주군 온양읍 내광리 산126번지"), "온양읍 내광리 김중환씨 근생신축");
  assert.equal(titleHint("(주)태웅산업", "경상북도 경주시 내남면 명계리 1842번지"), "(주)태웅산업");
});
check("창: 단계 반영일 60일 이내만", () => {
  assert.ok(withinVisitWindow("2026-08-15T00:00:00Z", "2026-10-06"));
  assert.ok(withinVisitWindow("2026-10-06T05:00:00+00:00", "2026-10-06")); // 당일 오전 동기화(KST 14시) 행
  assert.ok(withinVisitWindow("2026-08-07T00:00:00Z", "2026-10-06")); // 60일째
  assert.ok(!withinVisitWindow("2026-08-06T00:00:00Z", "2026-10-06")); // 61일째
  assert.ok(!withinVisitWindow("2026-07-14T00:00:00Z", "2026-10-06"));
  assert.ok(!withinVisitWindow(null, "2026-10-06"));
});

console.log("── 전화 탭 규칙 ──");
const ph = (o: Partial<PhoneInput>): PhoneInput => ({
  source: "nara_bid", stage: "awarded", stage_date: "2026-09-30", title: "남산 진입도로 정비공사", cnstwk_type: null,
  awarded_company: "정안 주식회사", awardee_tel: "054-777-0000", awardee_addr: "경상북도 경주시 현곡면 안현로 54-13", ...o,
});
check("A: 경주 소재 30일 / B: RC(제목으로 읽는 시점 판정) 90일 / 둘 다", () => {
  assert.equal(phoneRuleMatch(ph({}), "2026-10-06"), "local");
  assert.equal(phoneRuleMatch(ph({ stage_date: "2026-08-20" }), "2026-10-06"), null);
  assert.equal(phoneRuleMatch(ph({ awardee_addr: "서울특별시", stage_date: "2026-08-20", title: "(가칭)포항도서관 건립공사" }), "2026-10-06"), "rc");
  assert.equal(phoneRuleMatch(ph({ title: "불국 하동소하천 소교량 개체공사" }), "2026-10-06"), "both");
});
check("RC 판정은 저장된 usage와 무관 — 공사종류 '유지보수공사'면 RC 아님", () => {
  assert.equal(phoneRuleMatch(ph({ awardee_addr: "서울특별시", title: "마을회관 신축공사", cnstwk_type: "전문공사-유지보수공사" }), "2026-10-06"), null);
  assert.equal(phoneRuleMatch(ph({ awardee_addr: "서울특별시", title: "마을회관 신축공사", cnstwk_type: "종합공사-신설공사" }), "2026-10-06"), "rc");
});
check("마스킹 전화·비철근 사명(전설·조경)·비철근 제목·비공사는 제외", () => {
  assert.equal(phoneRuleMatch(ph({ awardee_tel: "***********" }), "2026-10-06"), null);
  assert.equal(phoneRuleMatch(ph({ awarded_company: "봉진전설(주)" }), "2026-10-06"), null);
  assert.equal(phoneRuleMatch(ph({ awarded_company: "주식회사 삼우조경" }), "2026-10-06"), null);
  assert.equal(phoneRuleMatch(ph({ title: "LED조명 교체공사" }), "2026-10-06"), null);
  assert.equal(phoneRuleMatch(ph({ title: "청사 신축 설계용역" }), "2026-10-06"), null);
  assert.equal(phoneRuleMatch(ph({ awarded_company: "(주)이후건축디자인" }), "2026-10-06"), "local");
});

console.log("── 상태·결과 코드 ──");
check("미접촉=오늘, 기한 도래=오늘, 기한 전=대기, 제외=완료, 기록 뒤 단계 변경=오늘", () => {
  const log = (created_at: string, follow_up_on: string | null) => ({ created_at, contacted_on: created_at.slice(0, 10), follow_up_on, result: "다음에" });
  assert.equal(deriveStatus({ dismissed_at: null, stage_changed_at: "2026-09-19T00:00:00Z", logs: [] }, "2026-10-06"), "today");
  assert.equal(deriveStatus({ dismissed_at: null, stage_changed_at: "2026-09-19T00:00:00Z", logs: [log("2026-10-01T09:00:00Z", "2026-10-06")] }, "2026-10-06"), "today");
  assert.equal(deriveStatus({ dismissed_at: null, stage_changed_at: "2026-09-19T00:00:00Z", logs: [log("2026-10-01T09:00:00Z", "2026-10-08")] }, "2026-10-06"), "waiting");
  assert.equal(deriveStatus({ dismissed_at: "2026-10-02T00:00:00Z", stage_changed_at: null, logs: [] }, "2026-10-06"), "done");
  assert.equal(deriveStatus({ dismissed_at: null, stage_changed_at: "2026-10-05T00:00:00Z", logs: [log("2026-10-01T09:00:00Z", "2026-10-20")] }, "2026-10-06"), "today");
  assert.equal(deriveStatus({ dismissed_at: null, stage_changed_at: null, logs: [log("2026-10-01T09:00:00Z", null)] }, "2026-10-06"), "waiting");
});
check("다음 행동일 없는 기록(수기 등)은 접촉일 + 7일에 다시 '오늘'", () => {
  const log = { created_at: "2026-10-01T09:00:00Z", contacted_on: "2026-10-01", follow_up_on: null, result: "다음에" };
  assert.equal(deriveStatus({ dismissed_at: null, stage_changed_at: null, logs: [log] }, "2026-10-07"), "waiting");
  assert.equal(deriveStatus({ dismissed_at: null, stage_changed_at: null, logs: [log] }, "2026-10-08"), "today");
});
check("방문 창: stage_changed_at 없으면 created_at(구 수집기 행도 창 안)", () => {
  const row: VisitSourceRow = {
    id: "00000000-0000-0000-0000-000000000001", source: "building_permit", region: "gyeongju", stage: "construction_start",
    floor_area: 300, usage: "neighborhood", address: "경상북도 경주시 평동 918-2", title: "평동 918-2", permit_date: "2026-08-01",
    start_date: "2026-09-01", stage_changed_at: null, created_at: "2026-10-07T00:40:00Z", dismissed_at: null, dismiss_reason: null,
    main_purps: "제2종근린생활시설", arch_gb: "신축", block: "",
  };
  const rows = buildVisitRows([row], new Map(), "2026-10-07");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].band, "near");
  assert.equal(rows[0].status, "today");
  assert.equal(buildVisitRows([{ ...row, created_at: "2026-07-01T00:00:00Z" }], new Map(), "2026-10-07").length, 0);
});
check("비철근 작업(숲가꾸기·포장·준설·지장물)은 non_steel, 전화 목록 제외 — 시설명 안의 작업어(청소년·태권도장·수목원)는 오판 안 함", () => {
  assert.equal(naraLabel("2026년 제1차 산불예방숲가꾸기사업(4-나지구)"), "non_steel");
  assert.equal(naraLabel("안강 산대초사거리 일원 포장정비공사"), "non_steel");
  assert.equal(naraLabel("하수도 기계준설공사(2026년 하반기)"), "non_steel");
  assert.equal(naraLabel("동천~황성 도시숲 지장물 철거공사"), "non_steel");
  assert.equal(naraLabel("○○청소년수련관 증축공사"), "rc");
  assert.notEqual(naraLabel("시민 태권도장 신축공사"), "non_steel"); // '도장'(도색) 오판 없음(건물유형 목록엔 없어 civil)
  assert.equal(naraLabel("수목원 방문자센터 신축공사"), "rc");
  assert.equal(naraLabel("건천 대곡1리 하수관로 설치공사(3차)"), "civil");
  assert.equal(phoneRuleMatch(ph({ awarded_company: "주식회사 경주임업", title: "2026년 제1차 산불예방숲가꾸기사업(4-라지구)" }), "2026-10-06"), null);
  assert.equal(phoneRuleMatch(ph({ awarded_company: "일등건설 주식회사", title: "안강 산대초사거리 일원 포장정비공사" }), "2026-10-06"), null);
});
check("CSV: 수식 선행문자 중화·따옴표/줄바꿈 인용", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+82"), "'+82");
  assert.equal(csvCell("@SUM"), "'@SUM");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("x\ry"), '"x\ry"');
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell(null), "");
});
check("결과 문구 정규화 — 수기 자유 텍스트도 4코드로(거절이 있으면 수신거부)", () => {
  assert.equal(normalizeResultCode("철근 안 씀·거절"), "철근 안 씀·거절");
  assert.equal(normalizeResultCode("철근안씀 거절"), "철근 안 씀·거절");
  assert.equal(normalizeResultCode("거절함"), "철근 안 씀·거절");
  assert.equal(normalizeResultCode("견적 거절"), "철근 안 씀·거절");
  assert.equal(normalizeResultCode("현장 없음"), "현장 없음·연락 불가·폐업");
  assert.equal(normalizeResultCode("폐업했음"), "현장 없음·연락 불가·폐업");
  assert.equal(normalizeResultCode("견적요청"), "견적 요청");
  assert.equal(normalizeResultCode("부재중"), "다음에");
  assert.equal(normalizeResultCode(""), null);
});
check("메모의 레이더 id 추출 — 형식 변형 허용, '레이더' 없으면 무시", () => {
  const id = "9a10573f-1234-4abc-8def-0123456789ab";
  assert.equal(extractRadarId(`레이더 ${id}`), id);
  assert.equal(extractRadarId(`레이더 id: ${id.toUpperCase()}`), id);
  assert.equal(extractRadarId(`통화함\n레이더 - ${id}`), id);
  assert.equal(extractRadarId(id), null);
  assert.equal(extractRadarId("레이더 메모만"), null);
});
check("제외 결과 기록인데 제외 안 된 행(복구·연결 전)은 '오늘', 제외되면 '완료'", () => {
  const log = { created_at: "2026-10-01T09:00:00Z", contacted_on: "2026-10-01", follow_up_on: null, result: "현장 없음·연락 불가·폐업" };
  assert.equal(deriveStatus({ dismissed_at: null, stage_changed_at: null, logs: [log] }, "2026-10-02"), "today");
  assert.equal(deriveStatus({ dismissed_at: "2026-10-01T09:00:01Z", stage_changed_at: null, logs: [log] }, "2026-10-02"), "done");
});
check("regionSuspect 의 xx포항은 regionFromText 와 같은 판정(감포항·서포항은 정상)", () => {
  assert.equal(regionSuspect({ title: "감포항 친수공간 조성사업", ordering_org: "해양수산부 포항지방해양수산청" }), null);
  assert.equal(regionSuspect({ title: "감포항 남측호안 보강공사", ordering_org: "경상북도" }), null);
  assert.ok(regionSuspect({ title: "무창포항 정비", ordering_org: "충청남도 보령시" }));
});
check("공사 범위 나열 괄호(건축·토목 포함) 안의 조경·기계는 비철근 아님 — 단일 공종 괄호는 그대로 비철근", () => {
  assert.equal(naraLabel("탄소중립 특화 지식산업센터 건립사업(건축,가시설,토목,조경,기계)"), "rc");
  assert.equal(naraLabel("중앙도서관 그린리모델링 공사(건축 및 기계설비)"), "civil");
  assert.equal(naraLabel("포항 경로당 신축공사(소방)"), "non_steel");
  assert.equal(naraLabel("체육관 증축 외 공사(소방 공정)"), "non_steel");
});
check("RC 판정이 작업어 판정보다 먼저 — 작업어 목록에만 있는 단어가 RC 신축을 강등하지 않음", () => {
  assert.equal(naraLabel("산림경영센터 신축공사"), "rc");
  assert.equal(naraLabel("산불대응센터 신축공사"), "rc");
  assert.equal(naraLabel("2026년 산불예방숲가꾸기사업"), "non_steel");
});
check("'울주' 단독 표기는 울산('서울주택'은 아님), regionSuspect 는 광역 발주처 권역어를 증거로 안 씀", () => {
  assert.equal(regionFromText("울주 서생면 하수관로 정비"), "ulsan");
  assert.equal(regionFromText("서울주택도시개발공사"), null);
  assert.ok(regionSuspect({ title: "국도7호선 영덕 축산 낙석 정비공사", ordering_org: "부산지방국토관리청 포항국토관리사무소" }));
  assert.equal(regionSuspect({ title: "서포항농협 창고 신축", ordering_org: "○○농업협동조합" }), null);
  assert.equal(regionSuspect({ title: "불국 하동소하천 소교량 개체공사", ordering_org: "경상북도 경주시" }), null);
});
check("결과 정규화 경계 — 부정·번복은 거절 아님, 일시 부재는 '다음에', 수신거부·연락 말라는 거절", () => {
  assert.equal(normalizeResultCode("거절 안 함"), null);
  assert.equal(normalizeResultCode("미거절"), null);
  assert.equal(normalizeResultCode("견적 거절했다가 다시 요청"), "견적 요청");
  assert.equal(normalizeResultCode("부재중, 연락불가"), "다음에");
  assert.equal(normalizeResultCode("수신거부"), "철근 안 씀·거절");
  assert.equal(normalizeResultCode("다시 연락하지 마세요"), "철근 안 씀·거절");
  assert.equal(normalizeResultCode("결번"), "현장 없음·연락 불가·폐업");
  assert.equal(normalizeResultCode("현장없음·연락불가·폐업"), "현장 없음·연락 불가·폐업");
});
check("메모 id: '레이더' 바로 뒤 UUID 우선, 다른 UUID 가 둘 이상이면 추측하지 않음", () => {
  const rid = "9a10573f-1234-4abc-8def-0123456789ab";
  const other = "11111111-2222-4333-8444-555555555555";
  assert.equal(extractRadarId(`견적서 ${other}\n레이더 ${rid}`), rid);
  assert.equal(extractRadarId(`레이더 메모: ${other} ${rid}`), other); // '레이더' 바로 뒤가 우선
  assert.equal(extractRadarId(`레이더 확인이 필요한 메모입니다 — 견적서 ${other} / 거래 ${rid}`), null); // 근처에 없고 UUID 가 둘
});
check("전화 계정 숨김 — 거절은 이력 어디든, 연락 불가는 최신 기록일 때만", () => {
  const t = (result: string, created_at: string) => ({ contacted_on: created_at.slice(0, 10), result, created_at });
  assert.equal(hiddenByTouches([]), false);
  assert.equal(hiddenByTouches([t("철근 안 씀·거절", "2026-10-01T01:00:00Z"), t("견적 요청", "2026-10-05T01:00:00Z")]), true);
  assert.equal(hiddenByTouches([t("현장 없음·연락 불가·폐업", "2026-10-05T01:00:00Z")]), true);
  assert.equal(hiddenByTouches([t("현장 없음·연락 불가·폐업", "2026-10-01T01:00:00Z"), t("견적 요청", "2026-10-05T01:00:00Z")]), false);
  assert.equal(hiddenByTouches([t("부재중", "2026-10-01T01:00:00Z")]), false);
});
check("최신 기록이 거절이면 제외 처리 전이어도 '완료'(복구·재기록 불가)", () => {
  const log = { created_at: "2026-10-01T09:00:00Z", contacted_on: "2026-10-01", follow_up_on: null, result: "거절" };
  assert.equal(deriveStatus({ dismissed_at: null, stage_changed_at: null, logs: [log] }, "2026-10-02"), "done");
});
check("[복구] 가능 조건 — 영구 거절·거절 기록·창 밖 미접촉은 불가, 창 안 또는 기록 있는 행은 가능", () => {
  const base: VisitSourceRow = {
    id: "00000000-0000-0000-0000-0000000000a1", source: "building_permit", region: "gyeongju", stage: "construction_start",
    floor_area: 300, usage: "neighborhood", address: "경상북도 경주시 황성동 290-13번지", title: "황성동 290-13", permit_date: "2026-08-01",
    start_date: "2026-09-01", stage_changed_at: "2026-09-19T00:00:00Z", created_at: "2026-09-19T00:00:00Z",
    dismissed_at: "2026-10-06T00:00:00Z", dismiss_reason: "기타", main_purps: "제2종근린생활시설", arch_gb: "신축", block: "",
  };
  const today = "2026-10-07";
  const one = (r: VisitSourceRow, logs: Array<{ result: string }> = []) =>
    buildVisitRows([r], new Map(logs.length ? [[r.id, logs.map((l, i) => ({ created_at: `2026-10-0${i + 1}T00:00:00Z`, contacted_on: `2026-10-0${i + 1}`, follow_up_on: null, result: l.result }))]] : []), today)[0];
  assert.equal(one(base).restorable, true); // 창 안 '기타'
  assert.equal(one({ ...base, stage_changed_at: "2026-07-01T00:00:00Z" }).restorable, false); // 창 밖 미접촉
  assert.equal(one({ ...base, stage_changed_at: "2026-07-01T00:00:00Z", dismiss_reason: "현장 없음·연락 불가·폐업" }, [{ result: "현장 없음·연락 불가·폐업" }]).restorable, true); // 창 밖이지만 기록 있음
  assert.equal(one({ ...base, dismiss_reason: "철근 안 씀·거절" }).restorable, false); // 영구 거절
  assert.equal(one(base, [{ result: "거절" }]).restorable, false); // 영업내역 거절 기록
});
check("방문 기록에서 확보한 업체명 — 주소·제목과 같은 prospect_name 은 업체명이 아님, 최신 우선", () => {
  const L = (prospect_name: string, created_at: string) => ({ created_at, contacted_on: created_at.slice(0, 10), follow_up_on: null, result: "다음에", prospect_name });
  const addr = "경상북도 경주시 황성동 290-13번지";
  assert.equal(companyHintFromLogs([L(addr, "2026-10-01T00:00:00Z")], addr, "황성동 290-13"), null);
  assert.equal(companyHintFromLogs([L("황성동 290-13", "2026-10-01T00:00:00Z")], addr, "황성동 290-13"), null);
  assert.equal(companyHintFromLogs([L("○○종합건설", "2026-10-01T00:00:00Z"), L("△△건설", "2026-10-03T00:00:00Z")], addr, "황성동 290-13"), "△△건설");
  assert.equal(companyHintFromLogs([], addr, null), null);
});
check("결과 코드 4종·제외 사유 3종·기본 기한 +7", () => {
  assert.equal(RESULT_CODES.length, 4);
  assert.equal(DISMISS_REASONS.length, 3);
  assert.equal(defaultFollowUp("견적 요청", "2026-10-06"), "2026-10-13");
  assert.equal(defaultFollowUp("다음에", "2026-10-06"), "2026-10-13");
  assert.equal(defaultFollowUp("철근 안 씀·거절", "2026-10-06"), null);
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
});

check("문자 가드: 동의는 정확히 '견적 요청'(괄호 메모 허용), 거절은 보수적으로", () => {
  for (const ok of ["견적 요청", "견적요청", " 견적·요청 ", "견적 요청(박 소장)", "견적 요청 [010-1234-5678]"]) {
    assert.equal(isExactQuoteRequest(ok), true, ok);
  }
  for (const no of ["견적 필요 없음", "견적서 발송", "견적 요청했다가 거절", "다음에 견적 요청 예정", "견적", "", null]) {
    assert.equal(isExactQuoteRequest(no), false, String(no));
  }
  for (const r of ["철근 안 씀·거절", "거절", "견적 요청했다가 거절", "견적 필요 없음", "수신거부", "연락하지 말라고 함", "철근 안 써요"]) {
    assert.equal(isRefusalForMms(r), true, r);
  }
  for (const r of ["견적 요청", "다음에", "현장 없음·연락 불가·폐업", null]) assert.equal(isRefusalForMms(r), false, String(r));
});
check("거래처명 정규화: (주)·주식회사·㈜·공백 무시", () => {
  assert.equal(normalizePartnerName("(주)엠에스 스틸"), normalizePartnerName("엠에스스틸 주식회사"));
  assert.equal(normalizePartnerName("㈜대동종합건설"), "대동종합건설");
  assert.notEqual(normalizePartnerName("대동건설"), normalizePartnerName("대동종합건설"));
  assert.equal(normalizePartnerName(null), "");
});

check("문자 가드: 출처 없는 ★ 거래처는 레이더가 처음 수집하기 전에 등록됐을 때만 '레이더 이전부터'", () => {
  const rows = ["2026-07-30T01:00:00+00:00", "2026-09-01T00:00:00.5+00:00"];
  assert.equal(registeredBeforeRadar("2026-06-17T04:00:00+00:00", rows), true); // 수집 전 등록(기존 거래처)
  assert.equal(registeredBeforeRadar("2026-08-25T04:00:00+00:00", rows), false); // 수집 뒤 등록(전화 캠페인 뒤 등록 등)
  assert.equal(registeredBeforeRadar("2026-07-30T01:00:00+00:00", rows), false); // 같은 시각 = 레이더가 먼저
  assert.equal(registeredBeforeRadar("2026-07-30T01:00:00.000001+00:00", ["2026-07-30T01:00:00.7+00:00"]), true); // 소수 자릿수 달라도 시각 비교
  assert.equal(registeredBeforeRadar(null, rows), false);
  assert.equal(registeredBeforeRadar("2026-06-17T04:00:00+00:00", []), false);
  assert.equal(registeredBeforeRadar("2026-06-17T04:00:00+00:00", [...rows, null]), false); // 날짜 깨지면 보수적으로
});

check("레이더 행 ↔ 거래처 embed 는 관계 이름 명시(0074 이후 FK 두 개 — 힌트 없으면 PGRST201)", () => {
  for (const f of ["lib/radar/radar-data.ts", "app/radar/page.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.equal(/[:,\s"`]partner\(/.test(src), false, `${f}: partner(...) embed 에 !construction_project_linked_partner_id_fkey 힌트 필요`);
  }
});

check("받는 번호 비교: 형식(대시·공백·괄호) 무시, 마스킹·자릿수 이상은 어떤 번호와도 같지 않음", () => {
  assert.equal(phoneKey("054-123-4567"), "0541234567");
  assert.equal(phoneKey("(054) 123 4567"), phoneKey("0541234567"));
  assert.equal(phoneKey("02-1234-5678"), "0212345678");
  assert.equal(phoneKey("010-1234-5678"), "01012345678");
  assert.equal(phoneKey("+82 10-1234-5678"), "01012345678"); // 국가번호
  assert.equal(phoneKey("+82-54-999-0741"), "0549990741");
  assert.equal(phoneKey("０５４-１２３-４５６７"), "0541234567"); // 전각 숫자
  assert.equal(phoneKey("054-***-4567"), null);
  assert.equal(phoneKey("***********"), null);
  assert.equal(phoneKey("1234-5678"), null); // 8자리(대표번호)는 레이더 낙찰사 전화 형식 아님
  assert.equal(phoneKey(""), null);
  assert.equal(phoneKey(null), null);
});

check("받는 번호: 저장값에 번호 여러 개·내선이면 포함 매칭, 서버는 발송할 숫자 그대로 검사", () => {
  assert.equal(phoneMatches("010-1234-5678", "01012345678"), true);
  assert.equal(phoneMatches("0101234567801022223333", "01022223333"), true); // 한 칸에 두 번호
  assert.equal(phoneMatches("054-123-4567 내선 203", "0541234567"), true); // 내선
  assert.equal(phoneMatches("054-***-4567", "0541234567"), false); // 마스킹
  assert.equal(phoneMatches("010-1234-5679", "01012345678"), false);
  assert.equal(phoneMatches(null, "01012345678"), false);
  // 문자 어댑터는 digitsOnly(to) 로 보낸다 → 서버 정규화(phoneKey(digitsOnly))가 발송 번호와 같아야 검사가 새지 않는다
  const dialed = (s: string) => s.replace(/\D/g, "");
  for (const typed of ["010-1234-5678*", "＊010-1234-5678", "010-1234-5678 ①", "010-1234-5678²", "010-1234-5678５"]) {
    const key = phoneKey(dialed(typed));
    assert.equal(key, dialed(typed), typed);
  }
  assert.equal(phoneKey(dialed("+82 10-1234-5678")), "01012345678"); // 국가번호는 국내 번호로 바꿔 발송
});

check("문자 가드: 캠페인(10-07 KST) 중 등록된 거래처는 ★ 행 시각과 무관하게 레이더 유래", () => {
  const later = ["2026-10-20T00:00:00+00:00"]; // 나중에 수집된 행만 ★ 연결된 경우
  assert.equal(preRadarPartner("2026-09-01T00:00:00+00:00", later), true); // 캠페인 전·수집 전 등록 = 레이더 이전부터
  assert.equal(preRadarPartner("2026-10-09T00:00:00+00:00", later), false); // 캠페인 중 등록 — 처음 연락한 행이 연결 안 돼도 레이더 유래
  assert.equal(preRadarPartner("2026-10-06T14:59:59+00:00", later), true); // 10-06 23:59:59 KST = 캠페인 전
  assert.equal(preRadarPartner("2026-10-06T15:00:00+00:00", later), false); // 10-07 00:00 KST = 캠페인 시작
  assert.equal(preRadarPartner("2026-09-01T00:00:00+00:00", ["2026-08-01T00:00:00+00:00"]), false); // 수집 뒤 등록
});

console.log(`\n✓ ${passed}개 통과`);
