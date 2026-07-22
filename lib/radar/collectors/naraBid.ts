/**
 * 관급 나라장터 어댑터 — 입찰공고(공사) + 낙찰(공사). 실호출 확정(2026-06).
 *
 * 핵심: 발주처(시청)는 돈 주는 곳이지 철강 사는 곳이 아니다. **낙찰사**가 실제 구매자.
 *       낙찰 API가 낙찰사명·대표·전화·주소까지 줘서 "지금 낙찰사에 전화"가 바로 된다.
 *       건축HUB(수주 지연)와 달리 **날짜 필터가 있어 준실시간**.
 *
 * 엔드포인트(네임스페이스 다름 주의):
 *   입찰공고: /1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwk
 *   낙찰:     /1230000/as/ScsbidInfoService/getScsbidListSttusCnstwk
 * 공통 파라미터: inqryDiv=1(공고/개찰일 기준) · inqryBgnDt/inqryEndDt(YYYYMMDDHHMM, 범위 ~1개월) · type=json
 * 응답: response.body.items[] (배열) · body.totalCount. 지역 요청필터 없음 → 전국 받아 현장지역으로 거른다.
 * 키: process.env.DATA_GO_KR_NARA_KEY ?? DATA_GO_KR_BUILDING_KEY (동일 data.go.kr 계정).
 * 참조(핸드오프): §3-B, §2 연락주체
 */

import type { CollectedProject, RadarRegion } from "../types";
import { buildUrl, fetchJsonRetry } from "./http";
import type { Collector, CollectContext } from "./types";

const BID_BASE = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwk";
const AWARD_BASE = "https://apis.data.go.kr/1230000/as/ScsbidInfoService/getScsbidListSttusCnstwk";
const PAGE = 100;
const MAX_PAGES_PER_WINDOW = 200; // 안전 상한 (전국 공사 ~12k/월 → ~128p)

/** 텍스트(현장지역/수요기관/공고명)에서 권역 판정. 권역 밖이면 null. */
export function matchRegion(text: string | null | undefined): RadarRegion | null {
  if (!text) return null;
  const s = String(text);
  if (s.includes("경주")) return "gyeongju";
  if (s.includes("포항")) return "pohang";
  if (s.includes("울산") || s.includes("울주")) return "ulsan";
  return null;
}

// 철근관련성 공종 분류.
//  - 판매(sell): 건축+구조토목 = 곧 철근 필요.
//  - 매입(buy): 건물 철거·해체 = 고철·중고철근 발생(철거업체 낙찰사 = 매입처).
// 제외: 비철근 공종 + 산림사업(조림·풀베기 등) + 비건물 철거(지장물·슬레이트 등) + 비공사(설계/감리/용역 등).
const NARA_EXCLUDE = ["전기", "통신", "조경", "식재", "수목", "청소", "소독", "방역", "방제", "제초", "산림유역", "산림경영", "조림", "숲가꾸기", "풀베기", "덩굴제거", "육림", "간벌", "벌채", "가지치기", "묘목", "임도", "사방", "준설", "퇴적", "오니", "방수", "도장", "포장", "아스팔트", "표지", "신호등", "CCTV", "cctv", "제설", "벌목", "간판", "현수막", "석면", "폐기물", "설계", "감리", "측량", "용역", "임대", "매각", "점검", "진단", "설비", "냉난방", "승강기", "기계설비"];
// 신규 건축 의도(보수·리모델링·철거와 구분). 건물 유형과 함께 있어야 building.
const NARA_NEWBUILD = ["신축", "증축", "개축", "재축", "건립", "신설", "증설"];
const NARA_BUILDING_TYPE = ["청사", "회관", "센터", "학교", "체육관", "강당", "도서관", "병원", "보건", "어린이집", "복지관", "사옥", "관사", "기숙사", "주택", "아파트", "공장", "창고", "주차장", "박물관", "미술관", "문화", "청소년", "경로당", "마을회관"];
const NARA_STRUCT = ["교량", "교각", "고가", "육교", "옹벽", "구조물", "암거", "지하차도", "터널", "배수장", "정수장", "취수장", "펌프장", "저수지", "보강토", "호안", "방음벽"];
// 매입 신호 — 철거·해체. 단 '건물' 철거만 철근/고철 多(지장물·과속방지턱·슬레이트는 컷).
const NARA_DEMOLITION = ["철거", "해체", "멸실"];
// 비건물 철거(도로변 구조물·지붕재 등) + 고철 안 나오는 해체(석면=유해물 제거) — 건물 키워드가 섞여도 우선 컷.
const NARA_DEMO_NONBUILDING = ["지장물", "과속방지턱", "방지턱", "슬레이트", "석면", "수목", "벌목", "가로등", "전주", "표지", "펜스", "휀스", "담장", "축대", "옹벽", "도로", "포장", "보도", "맨홀"];
const NARA_DEMO_BUILDING = ["건물", "건축물", "주택", "빌라", "빌딩", "연립", "다세대", "아파트", "상가", "점포", "빈집", "타운", "사옥", "공장", "창고", "청사", "회관", "센터", "학교", "체육관", "강당", "도서관", "병원", "보건", "어린이집", "복지관", "기숙사", "관사", "시장", "경로당", "마을회관", "축사"];

/**
 * 공고명/주공종 → 철근관련성·매입성.
 *  building/civil_struct/civil_low = 판매(sell). demolition = 매입(buy). exclude = 수집 컷.
 */
export function naraSteelCategory(
  text: string,
): "building" | "building_reno" | "civil_struct" | "civil_low" | "demolition" | "exclude" {
  // 철거·해체가 먼저 — 비건물 철거(지장물·슬레이트 등)는 건물 키워드가 섞여도 우선 컷, 그다음 건물 철거만 매입.
  if (NARA_DEMOLITION.some((k) => text.includes(k))) {
    if (NARA_DEMO_NONBUILDING.some((k) => text.includes(k))) return "exclude";
    return NARA_DEMO_BUILDING.some((k) => text.includes(k)) ? "demolition" : "exclude";
  }
  if (NARA_EXCLUDE.some((k) => text.includes(k))) return "exclude";
  const newBuild = NARA_NEWBUILD.some((k) => text.includes(k));
  const buildingType = NARA_BUILDING_TYPE.some((k) => text.includes(k));
  if (buildingType && newBuild) return "building"; // 신축/증축 건물 = 건축(강)
  // 구조물(교량·옹벽 등)은 신축 아니어도 구조토목.
  if (NARA_STRUCT.some((k) => text.includes(k))) return "civil_struct";
  // 건물 유형인데 신축 아님 = 리모델링·보수·기능보강 건축(철근 씀, 신축보단 적음).
  if (buildingType) return "building_reno";
  return "civil_low"; // 도로·상하수·정비 등 순수 토목 = 약(C)
}

/** "2026-05-02 13:16:05" / "2026-05-14" → "2026-05-02". */
function toIsoDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = String(v).match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 조인·중복키 = 공고번호(bidNtceNo)만. 차수(bidNtceOrd)는 제외한다.
 * 같은 공고의 재공고·정정은 차수가 늘지만 실체는 한 건 — 차수를 키에 넣으면 000/001/002…가
 * 각각 다른 행이 되고, 낙찰은 마지막 차수에만 붙어 "낙찰 vs 입찰공고" 중복이 생겼다.
 * 공고번호 단위로 합치고 낙찰을 우선(preferAwarded)해 한 건으로 만든다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bidKey(item: Record<string, any>): string | null {
  if (!item.bidNtceNo) return null;
  return String(item.bidNtceNo).trim();
}

/** 같은 공고번호가 여러 번 오면 낙찰 우선, 같은 단계면 최신 stage_date 우선(윈도우 순서 무관). */
function preferAwarded(existing: CollectedProject | undefined, incoming: CollectedProject): CollectedProject {
  if (!existing) return incoming;
  const rank = (p: CollectedProject) => (p.stage === "awarded" ? 1 : 0);
  if (rank(incoming) !== rank(existing)) return rank(incoming) > rank(existing) ? incoming : existing;
  return (incoming.stage_date ?? "") >= (existing.stage_date ?? "") ? incoming : existing;
}

const p2 = (n: number) => String(n).padStart(2, "0");
function ymdhm(d: Date): string {
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}`;
}

/** 오늘부터 days일을 ≤chunk일 윈도우들로 분할 (API 범위 제한 회피). */
function dateWindows(days: number, chunk = 28): Array<[string, string]> {
  const wins: Array<[string, string]> = [];
  let end = new Date();
  end.setHours(23, 59, 0, 0);
  let remaining = days;
  while (remaining > 0) {
    const span = Math.min(chunk, remaining);
    const bgn = new Date(end);
    bgn.setDate(bgn.getDate() - span);
    bgn.setHours(0, 0, 0, 0);
    wins.push([ymdhm(bgn), ymdhm(end)]);
    end = new Date(bgn);
    end.setMinutes(end.getMinutes() - 1);
    remaining -= span;
  }
  return wins;
}

/** 한 날짜 윈도우의 전 페이지 수집. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchWindow(base: string, key: string, bgn: string, end: string): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_WINDOW; page++) {
    const url = buildUrl(base, {
      serviceKey: key,
      pageNo: page,
      numOfRows: PAGE,
      inqryDiv: 1,
      inqryBgnDt: bgn,
      inqryEndDt: end,
      type: "json",
    });
    const json = await fetchJsonRetry(url);
    if (json?.["nkoneps.com.response.ResponseError"]) {
      const h = json["nkoneps.com.response.ResponseError"].header;
      throw new Error(`나라장터 에러 ${h?.resultCode} ${h?.resultMsg}`);
    }
    const body = json?.response?.body;
    let items = body?.items?.item ?? body?.items ?? [];
    items = Array.isArray(items) ? items : items ? [items] : [];
    if (items.length === 0) break;
    out.push(...items);
    const total = Number(body?.totalCount ?? 0);
    if (page * PAGE >= total) break;
  }
  return out;
}

/** 낙찰 item → awarded CollectedProject. 권역 밖이면 null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeAward(item: Record<string, any>, regionOverride?: RadarRegion): CollectedProject | null {
  const key = bidKey(item);
  if (!key) return null;
  // 권역: 입찰공고와 조인된 경우 공고의 현장지역(cnstrtsiteRgnNm)을 우선 사용.
  // 낙찰 응답엔 현장지역 필드가 없어 단독일 땐 수요기관/공고명으로 판정.
  const region = regionOverride ?? matchRegion(item.dminsttNm) ?? matchRegion(item.bidNtceNm);
  if (!region) return null;
  const category = naraSteelCategory(item.bidNtceNm ?? "");
  if (category === "exclude") return null; // 철근 무관 공종 컷

  const winner = item.bidwinnrNm?.trim() || null;
  const tel = item.bidwinnrTelNo?.trim() || null;
  return {
    source: "nara_bid",
    source_key: key,
    region,
    sigungu_code: null,
    project_type: "public",
    title: item.bidNtceNm?.trim() || "(공고명 미상)",
    address: item.dminsttNm?.trim() || null,
    usage: category,
    structure: null,
    floor_area: null,
    stage: "awarded",
    stage_date: toIsoDate(item.fnlSucsfDate ?? item.rlOpengDt),
    permit_date: null,
    sched_start_date: null,
    start_date: null,
    completion_date: null,
    ordering_org: item.dminsttNm?.trim() || null, // 발주처(표시용·연락대상 아님)
    contact_party: winner ? (tel ? `${winner} · ${tel}` : winner) : "낙찰사", // 낙찰사 + 전화
    awarded_company: winner,
    est_amount: num(item.sucsfbidAmt),
    raw: item,
  };
}

/** 입찰공고 item → bid_notice CollectedProject. 권역 밖이면 null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeBid(item: Record<string, any>): CollectedProject | null {
  const key = bidKey(item);
  if (!key) return null;
  const region =
    matchRegion(item.cnstrtsiteRgnNm) ?? matchRegion(item.dminsttNm) ?? matchRegion(item.bidNtceNm);
  if (!region) return null;
  const category = naraSteelCategory(`${item.bidNtceNm ?? ""} ${item.mainCnsttyNm ?? ""}`);
  if (category === "exclude") return null; // 철근 무관 공종 컷

  return {
    source: "nara_bid",
    source_key: key,
    region,
    sigungu_code: null,
    project_type: "public",
    title: item.bidNtceNm?.trim() || "(공고명 미상)",
    address: item.cnstrtsiteRgnNm?.trim() || item.dminsttNm?.trim() || null,
    usage: category,
    structure: null,
    floor_area: null,
    stage: "bid_notice",
    stage_date: toIsoDate(item.bidNtceDt),
    permit_date: null,
    sched_start_date: null,
    start_date: null,
    completion_date: null,
    ordering_org: item.dminsttNm?.trim() || item.ntceInsttNm?.trim() || null,
    contact_party: "낙찰 전 — 연락 대상 미정", // 낙찰 후 낙찰사로 채워짐
    awarded_company: null,
    est_amount: num(item.presmptPrce) ?? num(item.bdgtAmt),
    raw: item,
  };
}

export const naraBidCollector: Collector = {
  source: "nara_bid",
  label: "관급 나라장터(입찰+낙찰)",
  async collect(ctx: CollectContext): Promise<CollectedProject[]> {
    const key = process.env.DATA_GO_KR_NARA_KEY || process.env.DATA_GO_KR_BUILDING_KEY;
    if (!key) {
      console.warn("[radar] 나라장터 키 없음 — 관급 수집 건너뜀");
      return [];
    }

    const windows = dateWindows(ctx.naraWindowDays ?? 30);
    const out = new Map<string, CollectedProject>(); // source_key → 레코드 (낙찰 우선)

    for (const [bgn, end] of windows) {
      try {
        // 낙찰 전부 공고번호로 인덱싱 (지역 무관) — 공고의 현장지역으로 조인하기 위해.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const awardByKey = new Map<string, Record<string, any>>();
        for (const a of await fetchWindow(AWARD_BASE, key, bgn, end)) {
          const k = bidKey(a);
          if (k) awardByKey.set(k, a);
        }
        // 입찰공고: 현장지역(cnstrtsiteRgnNm)으로 권역 판정 → 낙찰 있으면 awarded(공고 지역으로).
        for (const b of await fetchWindow(BID_BASE, key, bgn, end)) {
          const region =
            matchRegion(b.cnstrtsiteRgnNm) ?? matchRegion(b.dminsttNm) ?? matchRegion(b.bidNtceNm);
          if (!region) continue;
          const k = bidKey(b);
          const award = k ? awardByKey.get(k) : null;
          const p = award ? normalizeAward(award, region) : normalizeBid(b);
          if (p) out.set(p.source_key, preferAwarded(out.get(p.source_key), p));
        }
        // 낙찰 자체가 지역 매칭되지만 입찰공고에서 못 잡은 것(공고가 기간 밖) 보강.
        for (const a of awardByKey.values()) {
          const p = normalizeAward(a);
          if (p) out.set(p.source_key, preferAwarded(out.get(p.source_key), p));
        }
      } catch (e) {
        console.error(`[radar] 관급 수집 실패 (${bgn}~${end}):`, (e as Error).message);
      }
    }

    let result = [...out.values()];
    if (ctx.regions) result = result.filter((p) => ctx.regions!.includes(p.region));
    return result;
  },
};
