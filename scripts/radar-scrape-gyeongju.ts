#!/usr/bin/env tsx
/** PoC: 경주시 고시/공고 스크랩 — 건축·개발 리드 밀도 측정. 임시 검증용. */
const BASE = "https://www.gyeongju.go.kr/open_content/ko/page.do";
const PAGES = Number(process.argv[2] ?? 10);

// 철근 관련(leading) 대형 개발 신호 — 선점 대상
const KW = [
  "도시계획도로", "도시계획시설", "도로구역", "개발행위", "지구단위", "산업단지",
  "정비사업", "재개발", "재건축", "도시개발", "택지", "부지조성", "주택건설", "공동주택",
  "대지조성", "건축위원회", "구조분야", "건축심의", "물류", "공장", "사용승인",
];
// 노이즈 컷 — 행정처분·세금·송달류
const EXCLUDE = [
  "시가표준액", "이행강제금", "공시송달", "취소", "위반", "처분", "반송", "납세", "과태료",
  "독촉", "송달", "예고",
];

async function fetchPage(n: number): Promise<string> {
  const res = await fetch(`${BASE}?mnu_uid=423&pageNo=${n}`, {
    headers: { "User-Agent": "Mozilla/5.0 (radar-poc)" },
  });
  return res.text();
}

function extract(html: string): Array<{ num: string; title: string; date: string }> {
  const out: Array<{ num: string; title: string; date: string }> = [];
  const re =
    /<td class="num">(\d+)<\/td>\s*<td class="aL title"><a[^>]*title="([^"]+)"[\s\S]*?<td class="date">\s*([\d.\-]+)\s*<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ num: m[1], title: m[2].trim(), date: m[3].trim() });
  return out;
}

(async () => {
  const all: Array<{ num: string; title: string; date: string }> = [];
  for (let n = 1; n <= PAGES; n++) all.push(...extract(await fetchPage(n)));
  if (all.length === 0) {
    console.log("추출 0 — 구조 변경 가능성. 정규식 재확인 필요.");
    return;
  }
  console.log(`스캔 게시물: ${all.length}건 | 날짜범위: ${all[all.length - 1].date} ~ ${all[0].date}`);
  const bld = all.filter(
    (r) => KW.some((k) => r.title.includes(k)) && !EXCLUDE.some((k) => r.title.includes(k)),
  );
  console.log(`대형 개발 선점 리드: ${bld.length}건 (노이즈 제외 후)`);
  console.log("\n=== 선점 리드 목록 ===");
  bld.forEach((r) => console.log(`${r.date} | ${r.title.slice(0, 54)}`));
})();
