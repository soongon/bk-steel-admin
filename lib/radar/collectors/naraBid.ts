/**
 * 관급 나라장터 어댑터 — 입찰공고(공사) + 낙찰(공사). 실호출 확정(2026-06), v2 규칙 반영(2026-10).
 *
 * 핵심: 발주처(시청)는 돈 주는 곳이지 철강 사는 곳이 아니다. **낙찰사**가 실제 구매자.
 *       낙찰 API가 낙찰사명·대표·전화·사업자번호·주소까지 줘서 "지금 낙찰사에 전화"가 바로 된다.
 *       건축HUB(수주 지연)와 달리 **날짜 필터가 있어 준실시간**.
 *
 * 엔드포인트(네임스페이스 다름 주의):
 *   입찰공고: /1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwk
 *   낙찰:     /1230000/as/ScsbidInfoService/getScsbidListSttusCnstwk
 * 공통 파라미터: inqryDiv=1(공고/개찰일 기준) · inqryBgnDt/inqryEndDt(YYYYMMDDHHMM, 범위 ~1개월) · type=json
 * 응답: response.body.items[] (배열) · body.totalCount. 지역 요청필터 없음 → 전국 받아 현장지역으로 거른다.
 * 키: process.env.DATA_GO_KR_NARA_KEY ?? DATA_GO_KR_BUILDING_KEY (동일 data.go.kr 계정).
 *
 * v2 변경(기획안 §7):
 *  ① 권역 판정 = nara-rules.matchRegionV2 (부분문자열 버그 수정: '울주'⊂서울주택, 'xx포항')
 *  ② 공종은 컷이 아니라 라벨(usage ∈ rc·civil·non_steel). 수집 컷은 비공사(설계·감리·용역·임대·매각…)뿐.
 *  ③ 입찰공고 공사종류(mtltyAdvcPsblYnCnstwkNm '유지보수공사')는 RC=false 라벨 입력.
 *  ④ 낙찰↔공고 조인은 **전 창 통합**(공고 창=공고일, 낙찰 창=등록일 기준이라 창이 어긋나는 게 구조적).
 *     조인되면 raw 병합(공고 raw 보존). 공고가 모든 창 밖인 낙찰은 DB의 기존 공고 행(현장지역·raw)으로 판정.
 *  ⑤ 낙찰 창이 하나라도 실패하면 미조인 공고로 bid_notice 를 만들지 않는다(기존 낙찰 행 역행 방지 — index.ts 가드와 이중).
 */

import type { CollectedProject, RadarRegion } from "../types";
import { matchRegionV2, naraLabel } from "../nara-rules";
import { buildUrl, fetchJsonRetry } from "./http";
import type { Collector, CollectContext, ExistingNaraRow } from "./types";

const BID_BASE = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwk";
const AWARD_BASE = "https://apis.data.go.kr/1230000/as/ScsbidInfoService/getScsbidListSttusCnstwk";
const PAGE = 100;
const MAX_PAGES_PER_WINDOW = 200; // 안전 상한 (전국 공사 ~12k/월 → ~128p)

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
export function dateWindows(days: number, chunk = 28): Array<[string, string]> {
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

/** 입찰공고 조인 정보 — 권역은 공고 현장지역(cnstrtsiteRgnNm)으로, 공사종류·raw는 공고에서. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface BidJoin { region: RadarRegion; raw: Record<string, any> }

/**
 * 낙찰 item → awarded CollectedProject. 권역 밖·비공사면 null.
 * 공고와 조인되면 공고의 권역·공사종류를 쓰고 raw = {...공고, ...낙찰}(공고 필드 보존).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeAward(item: Record<string, any>, bid?: BidJoin): CollectedProject | null {
  const key = bidKey(item);
  if (!key) return null;
  const title = String(item.bidNtceNm ?? "").trim();
  const region =
    bid?.region ?? matchRegionV2({ title, orderingOrg: item.dminsttNm }); // 낙찰 응답엔 현장지역 필드가 없음
  if (!region) return null;
  const label = naraLabel(title, bid?.raw?.mtltyAdvcPsblYnCnstwkNm ?? null);
  if (!label) return null; // 비공사(설계·감리·용역…)만 컷

  const winner = item.bidwinnrNm?.trim() || null;
  const tel = item.bidwinnrTelNo?.trim() || null;
  return {
    source: "nara_bid",
    source_key: key,
    region,
    sigungu_code: null,
    project_type: "public",
    title: title || "(공고명 미상)",
    address: item.dminsttNm?.trim() || null,
    usage: label,
    structure: null,
    floor_area: null,
    stage: "awarded",
    stage_date: toIsoDate(item.fnlSucsfDate ?? item.rlOpengDt),
    permit_date: null,
    sched_start_date: null,
    start_date: null,
    completion_date: null,
    ordering_org: item.dminsttNm?.trim() || null, // 발주처(표시용·연락대상 아님)
    contact_party: winner ? (tel ? `${winner} · ${tel}` : winner) : "낙찰사",
    awarded_company: winner,
    est_amount: num(item.sucsfbidAmt),
    raw: bid ? { ...bid.raw, ...item } : item,
  };
}

/** 입찰공고 item → bid_notice CollectedProject. 권역 밖·비공사면 null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeBid(item: Record<string, any>): CollectedProject | null {
  const key = bidKey(item);
  if (!key) return null;
  const title = String(item.bidNtceNm ?? "").trim();
  const region = bidRegion(item);
  if (!region) return null;
  const label = naraLabel(`${title} ${item.mainCnsttyNm ?? ""}`, item.mtltyAdvcPsblYnCnstwkNm ?? null);
  if (!label) return null;

  return {
    source: "nara_bid",
    source_key: key,
    region,
    sigungu_code: null,
    project_type: "public",
    title: title || "(공고명 미상)",
    address: item.cnstrtsiteRgnNm?.trim() || item.dminsttNm?.trim() || null,
    usage: label,
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

/** 입찰공고의 권역 — 현장지역(cnstrtsiteRgnNm) 최우선, 없으면 제목·발주처(광역 발주처 제외). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bidRegion(item: Record<string, any>): RadarRegion | null {
  return matchRegionV2({
    siteRegion: item.cnstrtsiteRgnNm,
    title: item.bidNtceNm,
    orderingOrg: item.dminsttNm ?? item.ntceInsttNm,
  });
}

/**
 * 공고가 수집 창 밖인 낙찰 — DB 기존 행으로 조인 정보 구성.
 *  - 기존 raw 에 현장지역(cnstrtsiteRgnNm)이 있으면 그것으로 판정(권역 밖이면 "out" = 적재 안 함).
 *  - 없으면 살아 있는 기존 행의 region. 기존 행이 없거나 soft-delete 면 undefined(제목·발주처 판정).
 */
export function joinFromExisting(ex: ExistingNaraRow | undefined): BidJoin | "out" | undefined {
  if (!ex) return undefined;
  const raw = (ex.raw ?? {}) as Record<string, unknown>;
  if (typeof raw.cnstrtsiteRgnNm === "string" && raw.cnstrtsiteRgnNm.trim()) {
    const r = bidRegion(raw);
    return r ? { region: r, raw } : "out";
  }
  if (!ex.deleted && ex.region) return { region: ex.region, raw };
  return undefined;
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
    const fail = (msg: string) => {
      console.error(`[radar] ${msg}`);
      ctx.onError?.("nara_bid", msg);
    };

    const windows = dateWindows(ctx.naraWindowDays ?? 30);
    const out = new Map<string, CollectedProject>(); // source_key → 레코드 (낙찰 우선)

    // ① 낙찰: 모든 창을 하나의 맵으로(창 단위 조인은 창 경계에서 낙찰을 놓쳐 행을 공고로 역행시켰다).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const awardByKey = new Map<string, Record<string, any>>();
    let awardsComplete = true;
    for (const [bgn, end] of windows) {
      try {
        for (const a of await fetchWindow(AWARD_BASE, key, bgn, end)) {
          const k = bidKey(a);
          if (k) awardByKey.set(k, a);
        }
      } catch (e) {
        awardsComplete = false;
        fail(`낙찰 수집 실패 (${bgn}~${end}): ${(e as Error).message}`);
      }
    }

    // ② 공고: 전 창 낙찰 맵과 조인. 현장지역(cnstrtsiteRgnNm)으로 권역 판정.
    const joined = new Set<string>();
    for (const [bgn, end] of windows) {
      try {
        for (const b of await fetchWindow(BID_BASE, key, bgn, end)) {
          const k = bidKey(b);
          const award = k ? awardByKey.get(k) : undefined;
          // 권역 판정 전에 조인 표시 — 현장지역이 '권역 밖'이라고 말한 공고의 낙찰이 단독 경로로 되살아나지 않게.
          if (k && award) joined.add(k);
          const region = bidRegion(b);
          if (!region) continue;
          if (!award && !awardsComplete) continue; // 낙찰 일부 누락 — 공고만으로 기존 낙찰 행을 덮지 않는다
          const p = award ? normalizeAward(award, { region, raw: b }) : normalizeBid(b);
          if (p) out.set(p.source_key, preferAwarded(out.get(p.source_key), p));
        }
      } catch (e) {
        fail(`입찰공고 수집 실패 (${bgn}~${end}): ${(e as Error).message}`);
      }
    }

    // ③ 낙찰 단독(공고가 모든 창 밖): DB 기존 공고 행의 현장지역·raw 우선, 없으면 제목·지역 발주처.
    const standalone = [...awardByKey.entries()].filter(([k]) => !joined.has(k));
    let existing = new Map<string, ExistingNaraRow>();
    if (standalone.length > 0 && ctx.existingNaraByKey) {
      try {
        existing = await ctx.existingNaraByKey(standalone.map(([k]) => k));
      } catch (e) {
        fail(`기존 관급 행 조회 실패: ${(e as Error).message}`);
      }
    }
    for (const [k, a] of standalone) {
      const join = joinFromExisting(existing.get(k));
      if (join === "out") continue;
      const p = normalizeAward(a, join);
      if (p) out.set(p.source_key, preferAwarded(out.get(p.source_key), p));
    }

    let result = [...out.values()];
    if (ctx.regions) result = result.filter((p) => ctx.regions!.includes(p.region));
    return result;
  },
};
