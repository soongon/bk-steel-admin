/**
 * 관급 나라장터 어댑터 — 조달청 입찰공고(공사) + 낙찰정보.
 *
 * 핵심: 발주처(시청)는 '돈 주는 곳'이지 철강 사는 곳이 아니다. 입찰공고만 보면 의미 없고,
 *       낙찰정보로 "누가 따갔나"를 붙여야 진짜 구매자(=낙찰사)가 나온다.
 *       → 공고번호(bidNtceNo)로 입찰↔낙찰 조인. 연락 주체 = 낙찰사.
 * 오퍼레이션: 공사 전용(getBidPblancListInfoCnstwk 계열). 물품/용역 오퍼레이션 쓰면 응답 안 옴.
 *
 * ⚠️ 필드/오퍼레이션 정확명은 활용명세서로 재확인 — TODO(명세).
 *    키 없으면 [] 반환. 키: process.env.DATA_GO_KR_NARA_KEY
 * 참조(핸드오프): §3-B, §2 연락주체
 */

import type { CollectedProject, RadarRegion, RadarStage } from "../types";
import { buildUrl, fetchJson } from "./http";
import type { Collector, CollectContext } from "./types";

// TODO(명세): 엔드포인트·오퍼레이션 확정.
const BID_BASE = "https://apis.data.go.kr/1230000/BidPublicInfoService/getBidPblancListInfoCnstwk";
const AWARD_BASE = "https://apis.data.go.kr/1230000/ScsbidInfoService/getScsbidListInfoCnstwk";

/** 텍스트(주소/기관/공고명)에서 권역 판정. 권역 밖이면 null(제외). */
export function matchRegion(text: string | null | undefined): RadarRegion | null {
  if (!text) return null;
  const s = String(text);
  if (s.includes("경주")) return "gyeongju";
  if (s.includes("포항")) return "pohang";
  if (s.includes("울산") || s.includes("울주")) return "ulsan";
  return null;
}

/** 'YYYY-MM-DD ...' / 'YYYYMMDD' 등에서 날짜만 ISO로. */
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

/** 입찰공고 + (있으면) 낙찰 → CollectedProject. 공고번호/권역 없으면 null. */
export function normalizeBid(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 외부 응답
  bid: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 외부 응답
  award: Record<string, any> | null,
): CollectedProject | null {
  // TODO(명세): 공고번호 필드 확인 (bidNtceNo).
  const sourceKey = bid.bidNtceNo ?? null;
  if (!sourceKey) return null;

  // 지역: 참가가능지역 → 수요기관 → 발주기관 → 공고명 순으로 텍스트 매칭.
  // TODO(명세): 참가가능지역 코드(시도)가 있으면 그걸 1차로.
  const region =
    matchRegion(bid.rgnLmtBidLocplcArea) ??
    matchRegion(bid.dminsttNm) ??
    matchRegion(bid.ntceInsttNm) ??
    matchRegion(bid.bidNtceNm);
  if (!region) return null;

  // TODO(명세): 낙찰사명 필드 확인 (scsbidCorpNm / opengCorpInfo 계열).
  const awardedCompany = award?.scsbidCorpNm ?? award?.bidwinnrNm ?? null;
  const stage: RadarStage = awardedCompany ? "awarded" : "bid_notice";
  const stageDate = awardedCompany
    ? toIsoDate(award?.opengDt ?? award?.rlOpengDt)
    : toIsoDate(bid.bidNtceDt);

  return {
    source: "nara_bid",
    source_key: String(sourceKey),
    region,
    sigungu_code: null,
    project_type: "public",
    title: bid.bidNtceNm?.trim() ?? "(공고명 미상)",
    address: bid.rgnLmtBidLocplcArea?.trim() ?? null,
    usage: null, // 관급 공사 공고엔 용도 없음 → 점수는 규모·거리 보강 후
    structure: null,
    floor_area: null,
    stage,
    stage_date: stageDate,
    ordering_org: (bid.dminsttNm ?? bid.ntceInsttNm)?.trim() ?? null, // 발주처(표시용·연락대상 아님)
    contact_party: awardedCompany ?? "낙찰 전 — 연락 대상 미정", // 낙찰 후에만 실제 연락처(낙찰사)
    awarded_company: awardedCompany,
    est_amount: num(bid.presmptPrce) ?? num(bid.bssamt),
    raw: { bid, award },
  };
}

export const naraBidCollector: Collector = {
  source: "nara_bid",
  label: "관급 나라장터(입찰+낙찰)",
  async collect(ctx: CollectContext): Promise<CollectedProject[]> {
    const key = process.env.DATA_GO_KR_NARA_KEY;
    if (!key) {
      console.warn("[radar] DATA_GO_KR_NARA_KEY 없음 — 관급 수집 건너뜀");
      return [];
    }

    const out: CollectedProject[] = [];
    const numOfRows = ctx.maxRowsPerRegion ?? 100;

    try {
      // TODO(명세): inqryDiv·검색기간(inqryBgnDt/inqryEndDt)·지역 파라미터·페이징 추가.
      const bidUrl = buildUrl(BID_BASE, { serviceKey: key, numOfRows, pageNo: 1, type: "json" });
      const bidJson = await fetchJson(bidUrl);
      const rawBids = bidJson?.response?.body?.items ?? [];
      const bids = Array.isArray(rawBids) ? rawBids : [rawBids];

      // 낙찰정보 조인: 공고번호 → 낙찰사.
      // TODO(명세): AWARD_BASE 호출(개찰결과/최종낙찰자)해서 awardByNo 채우기.
      //   const awardJson = await fetchJson(buildUrl(AWARD_BASE, { serviceKey: key, ... }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 외부 응답
      const awardByNo = new Map<string, any>();
      void AWARD_BASE; // (키 도착 후 사용)

      for (const bid of bids) {
        const award = awardByNo.get(String(bid.bidNtceNo)) ?? null;
        const p = normalizeBid(bid, award);
        if (p && (!ctx.regions || ctx.regions.includes(p.region))) out.push(p);
      }
    } catch (e) {
      console.error("[radar] 관급 수집 실패:", (e as Error).message);
    }
    return out;
  },
};
