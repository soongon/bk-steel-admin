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

// 철근관련성 공종 분류 (사용자 확정: 건축+구조토목만 영업대상).
// 제외: 비철근 공종 + 철거·해체(신규 철근 0) + 비공사(설계/감리/용역 등).
const NARA_EXCLUDE = ["전기", "통신", "조경", "식재", "수목", "청소", "소독", "방역", "방제", "제초", "임도", "사방", "준설", "퇴적", "오니", "방수", "도장", "포장", "아스팔트", "표지", "신호등", "CCTV", "cctv", "제설", "벌목", "간판", "현수막", "철거", "해체", "멸실", "석면", "폐기물", "설계", "감리", "측량", "용역", "임대", "매각", "점검", "진단", "설비", "냉난방", "승강기", "기계설비"];
// 신규 건축 의도(보수·리모델링·철거와 구분). 건물 유형과 함께 있어야 building.
const NARA_NEWBUILD = ["신축", "증축", "개축", "재축", "건립", "신설", "증설"];
const NARA_BUILDING_TYPE = ["청사", "회관", "센터", "학교", "체육관", "강당", "도서관", "병원", "보건", "어린이집", "복지관", "사옥", "관사", "기숙사", "주택", "아파트", "공장", "창고", "주차장", "박물관", "미술관", "문화", "청소년", "경로당", "마을회관"];
const NARA_STRUCT = ["교량", "교각", "고가", "육교", "옹벽", "구조물", "암거", "지하차도", "터널", "배수장", "정수장", "취수장", "펌프장", "저수지", "보강토", "호안", "방음벽"];

/** 공고명/주공종 → 철근관련성. exclude=수집 컷. building=신축 건물(철근 多). */
export function naraSteelCategory(text: string): "building" | "civil_struct" | "civil_low" | "exclude" {
  if (NARA_EXCLUDE.some((k) => text.includes(k))) return "exclude";
  const newBuild = NARA_NEWBUILD.some((k) => text.includes(k));
  const buildingType = NARA_BUILDING_TYPE.some((k) => text.includes(k));
  if (buildingType && newBuild) return "building"; // 신축/증축 건물
  if (NARA_STRUCT.some((k) => text.includes(k))) return "civil_struct"; // 교량·옹벽 등 구조물
  return "civil_low"; // 보수·리모델링·도로·상하수 등 = 약(C)
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

/** 공고번호+차수 = 입찰공고 ↔ 낙찰 조인키. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bidKey(item: Record<string, any>): string | null {
  if (!item.bidNtceNo) return null;
  return `${item.bidNtceNo}-${item.bidNtceOrd ?? "000"}`;
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
export function normalizeAward(item: Record<string, any>): CollectedProject | null {
  const key = bidKey(item);
  if (!key) return null;
  // 낙찰엔 현장지역 필드가 없어 수요기관/공고명으로 판정 (낙찰사 주소는 시공사 소재지라 제외).
  const region = matchRegion(item.dminsttNm) ?? matchRegion(item.bidNtceNm);
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
    // 공고번호 → 레코드. 낙찰(awarded) 우선, 없으면 입찰공고(bid_notice).
    const awarded = new Map<string, CollectedProject>();
    const notices = new Map<string, CollectedProject>();

    for (const [bgn, end] of windows) {
      try {
        for (const a of await fetchWindow(AWARD_BASE, key, bgn, end)) {
          const p = normalizeAward(a);
          if (p) awarded.set(p.source_key, p);
        }
        for (const b of await fetchWindow(BID_BASE, key, bgn, end)) {
          const p = normalizeBid(b);
          if (p && !awarded.has(p.source_key)) notices.set(p.source_key, p);
        }
      } catch (e) {
        console.error(`[radar] 관급 수집 실패 (${bgn}~${end}):`, (e as Error).message);
      }
    }

    let out = [...awarded.values(), ...notices.values()];
    if (ctx.regions) out = out.filter((p) => ctx.regions!.includes(p.region));
    return out;
  },
};
