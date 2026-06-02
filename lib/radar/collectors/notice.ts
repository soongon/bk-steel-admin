/**
 * 시청 고시(선점) 어댑터 — 시청 고시·공고 게시판 스크랩.
 *
 * "대형 개발 선점 레이더": 산업단지·물류단지·정비사업·대형건축 심의·개발행위·도시계획.
 * 착공 스트림이 아니라 **가장 이른 대형 철근 수요 신호**(계획 승인 단계 = 착공 몇 달~몇 년 전).
 * 고시 **게시일을 stage_date에 저장**(날짜 핵심). 원문 링크는 source_url.
 *
 * 경주(gyeongju.go.kr)·포항(pohang.go.kr 새올)·울산(ulsan.go.kr 휴먼프레임워크) 검증 완료.
 * 게시판마다 HTML·페이징이 달라 per-city parse + request(GET/POST) 로 분리.
 * 참조(PoC): scripts/radar-scrape-gyeongju.ts
 */

import type { CollectedProject, RadarRegion } from "../types";
import type { Collector, CollectContext } from "./types";

interface NoticeBoard {
  region: RadarRegion;
  origin: string;
  // 페이지 요청 — 게시판별 GET(기본) 또는 POST(울산 list.ulsan) 분기.
  // eslint-disable-next-line no-unused-vars
  request: (pageNo: number) => { url: string; method?: "GET" | "POST"; body?: string };
  // eslint-disable-next-line no-unused-vars
  parse: (html: string, origin: string) => NoticeRow[];
}
interface NoticeRow {
  key: string;
  title: string;
  date: string; // YYYY-MM-DD (게시일)
  url: string;
}

// 철근 관련 대형 개발 신호 (선점 대상). noticeCategory 와 키워드 정합 유지.
const INCLUDE = [
  "도시계획도로", "도시계획시설", "도로구역", "개발행위", "지구단위", "산업단지", "산단", "물류단지",
  "물류센터", "정비사업", "재개발", "재건축", "도시개발", "택지", "부지조성", "주택건설", "공동주택",
  "대지조성", "건축위원회", "구조분야", "건축심의", "공장", "산업로", "빗물펌프장",
];
// 노이즈 컷 — 행정처분·세금·송달·지적도 + 용역공고·생활프로그램(실제 발주 아님)
const EXCLUDE = [
  "시가표준액", "이행강제금", "공시송달", "취소", "위반", "처분", "반송", "납세", "과태료",
  "독촉", "송달", "예고", "지적도", "채용", "입찰", "수의계약",
  "금연", "공동체 활성화", "수행능력", "수행기관", "안전점검",
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

/** 제목 정리 — 태그(새글 뱃지 등) 제거 · &amp; 복원 · 공백 접기. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
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

/** 포항 새올 고시·일반공고 게시판(seCode=01) 행 파서. data-action 의 notAncmtMgtNo 가 자연키. */
function parsePohang(html: string, origin: string): NoticeRow[] {
  const out: NoticeRow[] = [];
  // 목록 <a> 의 data-action(notAncmtMgtNo)만 — 같은 행의 list_date td 까지가 한 행.
  const re =
    /<a\b[^>]*data-action="([^"]*notAncmtMgtNo=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td class="list_date"[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({
      key: `pohang-${m[2]}`,
      title: cleanTitle(m[3]),
      date: m[4],
      url: origin + m[1].replace(/&amp;/g, "&"),
    });
  }
  return out;
}

/** 울산광역시 고시공고 게시판 행 파서. 노드ID(`46444.ulsan`)가 자연키, 행 마지막 td 가 게시일. */
function parseUlsan(html: string, origin: string): NoticeRow[] {
  const out: NoticeRow[] = [];
  // gosi td 의 <a href="./NNNN.ulsan…"> ~ 같은 행 마지막 td(게시일)/</tr>. class·속성 변화에 견고하게 완화.
  const re =
    /<td class="gosi[^"]*"[^>]*>\s*<a\b[^>]*href="\.\/(\d+)\.ulsan([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/td>\s*<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({
      key: `ulsan-${m[1]}`,
      title: cleanTitle(m[3]),
      date: m[4],
      // 목록 페이지(/u/rep/contents.ulsan) 기준 ./NNNN.ulsan → /u/rep/transfer/notice/NNNN.ulsan (상세는 이 경로에서만 열림).
      url: `${origin}/u/rep/transfer/notice/${m[1]}.ulsan${m[2].replace(/&amp;/g, "&")}`,
    });
  }
  return out;
}

const BOARDS: NoticeBoard[] = [
  {
    region: "gyeongju",
    origin: "https://www.gyeongju.go.kr",
    request: (n) => ({ url: `https://www.gyeongju.go.kr/open_content/ko/page.do?mnu_uid=423&pageNo=${n}` }),
    parse: parseGyeongju,
  },
  {
    region: "pohang",
    origin: "https://www.pohang.go.kr",
    request: (n) => ({
      url: `https://www.pohang.go.kr/portal/saeol/gosi/list.do?mid=0202010000&seCode=01&page=${n}`,
    }),
    parse: parsePohang,
  },
  {
    // 울산광역시 고시공고 — 도시계획·산단·도시개발 결정고시가 광역시 단위. 페이징은 POST(list.ulsan, curPage) 전용.
    region: "ulsan",
    origin: "https://www.ulsan.go.kr",
    request: (n) => ({
      url: "https://www.ulsan.go.kr/u/rep/transfer/notice/list.ulsan",
      method: "POST",
      body: `mId=001004002000000000&curPage=${n}`,
    }),
    parse: parseUlsan,
  },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** HTML 목록 fetch — 12s 타임아웃 + 1회 재시도. 한 게시판 무응답이 전체 수집을 멈추지 않게(building fetchJsonRetry 대응). */
async function fetchText(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  timeoutMs = 12000,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      return await res.text();
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
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
        let prevSig: string | null = null;
        for (let page = 1; page <= maxPages; page++) {
          const req = board.request(page);
          const html = await fetchText(req.url, {
            method: req.method ?? "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (radar)",
              ...(req.method === "POST"
                ? { "Content-Type": "application/x-www-form-urlencoded" }
                : {}),
            },
            body: req.body,
          });
          const rows = board.parse(html, board.origin);
          if (rows.length === 0) break;

          // 범위 밖 페이지에서 마지막 페이지를 반복 반환하는 게시판(울산 등) 방어 — 직전 페이지와 동일하면 중단.
          const sig = rows.map((r) => r.key).join(",");
          if (sig === prevSig) break;
          prevSig = sig;

          let newest = "0000";
          for (const r of rows) {
            if (r.date > newest) newest = r.date;
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
          // 이 페이지의 '가장 최신' 글도 윈도우 밖이면 이후 페이지는 전부 더 과거 → 중단.
          // (oldest 가 아니라 newest 기준 — 상단고정 공지의 옛 날짜에 조기중단되지 않게.)
          if (newest < cutoff) break;
        }
      } catch (e) {
        console.error(`[radar] 고시 수집 실패 ${board.region}:`, (e as Error).message);
      }
    }
    return out;
  },
};
