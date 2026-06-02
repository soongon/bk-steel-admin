/**
 * 시청 고시(선점) 어댑터 — 시청 고시·공고 게시판 스크랩.
 *
 * "대형 개발 선점 레이더": 산업단지·물류단지·정비사업·대형건축 심의·개발행위·도시계획.
 * 착공 스트림이 아니라 **가장 이른 대형 철근 수요 신호**(계획 승인 단계 = 착공 몇 달~몇 년 전).
 * 고시 **게시일을 stage_date에 저장**(날짜 핵심). 원문 링크는 source_url.
 *
 * 경주(gyeongju.go.kr) 검증 완료. 포항·울산은 게시판 URL/파서 추가 필요(TODO).
 * 참조(PoC): scripts/radar-scrape-gyeongju.ts
 */

import type { CollectedProject, RadarRegion } from "../types";
import type { Collector, CollectContext } from "./types";

interface NoticeBoard {
  region: RadarRegion;
  origin: string;
  listUrl: (pageNo: number) => string;
  // eslint-disable-next-line no-unused-vars
  parse: (html: string, origin: string) => NoticeRow[];
}
interface NoticeRow {
  key: string;
  title: string;
  date: string; // YYYY-MM-DD (게시일)
  url: string;
}

// 철근 관련 대형 개발 신호 (선점 대상)
const INCLUDE = [
  "도시계획도로", "도시계획시설", "도로구역", "개발행위", "지구단위", "산업단지", "물류단지",
  "정비사업", "재개발", "재건축", "도시개발", "택지", "부지조성", "주택건설", "공동주택",
  "대지조성", "건축위원회", "구조분야", "건축심의", "공장", "산업로", "빗물펌프장",
];
// 노이즈 컷 — 행정처분·세금·송달·지적도 등
const EXCLUDE = [
  "시가표준액", "이행강제금", "공시송달", "취소", "위반", "처분", "반송", "납세", "과태료",
  "독촉", "송달", "예고", "지적도", "채용", "입찰", "수의계약",
];

/** 고시 제목 → 철근관련성 카테고리. */
export function noticeCategory(title: string): string {
  if (/산업단지|물류단지|산단/.test(title)) return "industrial_complex";
  if (/정비사업|재개발|재건축|도시개발|택지|부지조성|주택건설|공동주택/.test(title)) return "redevelopment";
  if (/건축위원회|구조분야|건축심의/.test(title)) return "large_building";
  if (/도로|산업로|도로구역/.test(title)) return "road";
  if (/도시계획시설|펌프장|폐기물|방수|상수도|하수/.test(title)) return "infra";
  return "etc";
}

/** 경주 게시판(서버 HTML 테이블) 행 파서. */
function parseGyeongju(html: string, origin: string): NoticeRow[] {
  const out: NoticeRow[] = [];
  const re =
    /<td class="num">(\d+)<\/td>\s*<td class="aL title"><a href="([^"]+)"[^>]*title="([^"]+)"[\s\S]*?<td class="date">\s*([\d.\-]+)\s*<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[2].replace(/&amp;/g, "&");
    const bod = href.match(/parm_bod_uid=(\d+)/)?.[1] ?? m[1];
    out.push({
      key: `gyeongju-${bod}`,
      title: m[3].trim(),
      date: m[4].trim().replace(/\./g, "-"),
      url: origin + href,
    });
  }
  return out;
}

const BOARDS: NoticeBoard[] = [
  {
    region: "gyeongju",
    origin: "https://www.gyeongju.go.kr",
    listUrl: (n) => `https://www.gyeongju.go.kr/open_content/ko/page.do?mnu_uid=423&pageNo=${n}`,
    parse: parseGyeongju,
  },
  // TODO: 포항(pohang.go.kr)·울산 각 구군 — 게시판 URL + 파서 추가
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export const noticeCollector: Collector = {
  source: "notice",
  label: "시청 고시(선점)",
  async collect(ctx: CollectContext): Promise<CollectedProject[]> {
    const cutoff = isoDaysAgo(ctx.noticeWindowDays ?? 120);
    const maxPages = ctx.noticeMaxPages ?? 30;
    const out: CollectedProject[] = [];

    for (const board of BOARDS) {
      if (ctx.regions && !ctx.regions.includes(board.region)) continue;
      try {
        for (let page = 1; page <= maxPages; page++) {
          const res = await fetch(board.listUrl(page), {
            headers: { "User-Agent": "Mozilla/5.0 (radar)" },
          });
          const rows = board.parse(await res.text(), board.origin);
          if (rows.length === 0) break;

          let oldest = "9999";
          for (const r of rows) {
            if (r.date < oldest) oldest = r.date;
            if (r.date < cutoff) continue; // 기간 밖
            if (!INCLUDE.some((k) => r.title.includes(k))) continue;
            if (EXCLUDE.some((k) => r.title.includes(k))) continue;
            out.push({
              source: "notice",
              source_key: r.key,
              region: board.region,
              sigungu_code: null,
              project_type: "public",
              title: r.title,
              address: null,
              usage: noticeCategory(r.title),
              structure: null,
              floor_area: null,
              stage: "notice",
              stage_date: r.date, // ← 고시 게시일(핵심 날짜)
              permit_date: null,
              sched_start_date: null,
              start_date: null,
              completion_date: null,
              ordering_org: null,
              contact_party: "시청 고시(선점) — 원문·시행자 확인",
              awarded_company: null,
              est_amount: null,
              source_url: r.url,
              raw: r,
            });
          }
          if (oldest < cutoff) break; // 페이지가 기간 밖으로 넘어가면 중단
        }
      } catch (e) {
        console.error(`[radar] 고시 수집 실패 ${board.region}:`, (e as Error).message);
      }
    }
    return out;
  },
};
