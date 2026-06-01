/**
 * 민간 건축인허가 어댑터 — 국토부 건축HUB 건축인허가정보(기본개요).
 * 엔드포인트·응답구조·필드는 실호출로 확정(2026-05).
 *
 * 핵심: 건축허가 → 착공(realStcnsDay) 구간이 철강이 필요해지는 창. 착공 뜨면 '지금 전화'.
 *       연락 주체 = 건축주 / 시공사.
 *
 * 실응답 확정 사항:
 *  - 응답 경로: response.body.items.item[] (body.totalCount로 페이징, numOfRows 상한 100)
 *  - 필수 파라미터: sigunguCd + bjdongCd(법정동). sigunguCd만이면 빈 응답 → 법정동 순회.
 *  - 날짜 파라미터·정렬 없음 → 전체 페이징 후 클라이언트에서 active+recent 필터(upsert 볼륨 제어).
 *  - 자연키 mgmPmsrgstPk(숫자) · 실착공 realStcnsDay · 허가 archPmsDay · 사용승인 useAprDay
 *  - 건축구분 archGbCdNm(신축/증축만 관심) · 주용도 mainPurpsCdNm · 연면적 totArea/vlRatEstmTotArea
 *  - 주구조(strctCdNm)는 기본개요에 없음 → structure=null (동별개요 보강은 2차)
 * 키: process.env.DATA_GO_KR_BUILDING_KEY
 * 참조(핸드오프): §3-A
 */

import type { CollectedProject, RadarStage, StructureType } from "../types";
import { REGIONS, SIGUNGU_TO_REGION } from "../config";
import { buildUrl, fetchJson } from "./http";
import type { Collector, CollectContext } from "./types";

const BASE = "https://apis.data.go.kr/1613000/ArchPmsHubService/getApBasisOulnInfo";
const PAGE_SIZE = 100; // API 상한 (numOfRows>100 요청해도 100만 반환)

/** 주용도명 → 점수 카테고리. 핸드오프 §6 용도(스윗스팟/감산). */
export function normalizeUsage(mainPurpsCdNm: string | null | undefined): string | null {
  if (!mainPurpsCdNm) return null;
  const s = String(mainPurpsCdNm);
  if (s.includes("공장")) return "factory";
  if (s.includes("창고")) return "warehouse";
  if (s.includes("다세대") || s.includes("다가구") || s.includes("연립")) return "multi_family";
  if (s.includes("아파트")) return "apartment";
  if (s.includes("공동주택")) return "apartment"; // generic — TODO: 세부용도로 다세대 분리
  if (s.includes("근린생활")) return "neighborhood";
  if (s.includes("교육") || s.includes("학교")) return "education";
  return "etc";
}

/** 주구조명 → 구조 카테고리. 기본개요엔 없음(항상 undefined) → null. 동별개요 보강은 2차. */
export function normalizeStructure(
  strctCdNm: string | null | undefined,
): StructureType | null {
  if (!strctCdNm) return null;
  const s = String(strctCdNm);
  if (s.includes("철근콘크리트") || s.includes("RC") || s.includes("철근")) return "RC";
  if (s.includes("철골") || s.includes("강구조") || s.includes("S조")) return "steel";
  return "etc";
}

/** YYYYMMDD → YYYY-MM-DD. 빈/형식불일치는 null. */
function toIsoDate(yyyymmdd: string | null | undefined): string | null {
  if (!yyyymmdd) return null;
  const d = String(yyyymmdd).trim();
  if (!/^\d{8}$/.test(d)) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 단계: 사용승인 있으면 completed(기회 끝), 실착공 있으면 construction_start(지금 전화),
 * 둘 다 없으면 permit(모니터링).
 */
export function derivePermitStage(item: {
  useAprDay?: string | null;
  realStcnsDay?: string | null;
  archPmsDay?: string | null;
}): { stage: RadarStage; stageDate: string | null } {
  const useApr = toIsoDate(item.useAprDay);
  if (useApr) return { stage: "completed", stageDate: useApr };
  const stcns = toIsoDate(item.realStcnsDay);
  if (stcns) return { stage: "construction_start", stageDate: stcns };
  return { stage: "permit", stageDate: toIsoDate(item.archPmsDay) };
}

/** 신축·증축만 관심(핸드오프 §3-A). 그 외(대수선/용도변경/개축 등) 제외. 미상은 통과. */
function isNewOrExtension(archGbCdNm: unknown): boolean {
  if (!archGbCdNm) return true;
  const s = String(archGbCdNm);
  return s.includes("신축") || s.includes("증축");
}

/** 단일 응답 item → CollectedProject. 관심 외/자연키 없음이면 null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 외부 응답 item
export function normalizePermitItem(item: Record<string, any>, sigunguCd: string): CollectedProject | null {
  if (!isNewOrExtension(item.archGbCdNm)) return null;

  const pk = item.mgmPmsrgstPk ?? null; // 허가관리대장 PK
  if (pk == null) return null;

  const region = SIGUNGU_TO_REGION[sigunguCd];
  if (!region) return null;

  const { stage, stageDate } = derivePermitStage(item);

  return {
    source: "building_permit",
    // ⚠️ mgmPmsrgstPk는 전역 고유가 아니다(시군구 간 충돌 확인) → sigunguCd로 네임스페이스해
    //    cross-region upsert 덮어쓰기를 방지. (permit의 sigunguCd는 고정이라 안정적 키.)
    source_key: `${sigunguCd}-${pk}`,
    region,
    sigungu_code: sigunguCd,
    project_type: "private",
    title: item.bldNm?.trim() || item.platPlc?.trim() || "(이름 미상)",
    address: item.platPlc?.trim() ?? null,
    usage: normalizeUsage(item.mainPurpsCdNm),
    structure: normalizeStructure(item.strctCdNm), // 기본개요엔 없음 → null
    floor_area: num(item.totArea) ?? num(item.vlRatEstmTotArea),
    stage,
    stage_date: stageDate,
    ordering_org: null,
    contact_party: "건축주/시공사", // TODO: 건축주명 필드 있으면 채움
    awarded_company: null,
    est_amount: null,
    raw: item,
  };
}

/** active+recent 필터: 준공(completed) 제외 + stage_date가 기준일 이후. */
function keepActiveRecent(p: CollectedProject, cutoffIso: string): boolean {
  if (p.stage === "completed") return false;
  if (!p.stage_date) return false;
  return p.stage_date >= cutoffIso;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export const buildingPermitCollector: Collector = {
  source: "building_permit",
  label: "민간 건축인허가",
  async collect(ctx: CollectContext): Promise<CollectedProject[]> {
    const key = process.env.DATA_GO_KR_BUILDING_KEY;
    if (!key) {
      console.warn("[radar] DATA_GO_KR_BUILDING_KEY 없음 — 민간 수집 건너뜀");
      return [];
    }

    const out: CollectedProject[] = [];
    const maxPages = ctx.maxPagesPerBjdong ?? Number.POSITIVE_INFINITY;
    const cutoff = isoDaysAgo(ctx.activeWindowDays ?? 730);

    for (const region of REGIONS) {
      if (ctx.regions && !ctx.regions.includes(region.region)) continue;
      for (const sg of region.sigungu) {
        if (sg.bjdongCodes.length === 0) continue; // 미발견 시군구 스킵
        const bjdongCodes =
          ctx.maxBjdongPerSigungu != null
            ? sg.bjdongCodes.slice(0, ctx.maxBjdongPerSigungu)
            : sg.bjdongCodes;

        for (const bjdongCd of bjdongCodes) {
          try {
            for (let page = 1; page <= maxPages; page++) {
              const url = buildUrl(BASE, {
                serviceKey: key,
                sigunguCd: sg.code,
                bjdongCd,
                numOfRows: PAGE_SIZE,
                pageNo: page,
                _type: "json",
              });
              const json = await fetchJson(url);
              const body = json?.response?.body;
              const rawItems = body?.items?.item ?? [];
              const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
              if (items.length === 0) break;

              for (const it of items) {
                const p = normalizePermitItem(it, sg.code);
                if (p && keepActiveRecent(p, cutoff)) out.push(p);
              }

              const total = Number(body?.totalCount ?? 0);
              if (page * PAGE_SIZE >= total) break;
            }
          } catch (e) {
            console.error(`[radar] 민간 수집 실패 ${sg.code}/${bjdongCd}:`, (e as Error).message);
          }
        }
      }
    }
    return out;
  },
};
