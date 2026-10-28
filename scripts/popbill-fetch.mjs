// 팝빌 사이트 홈택스수집 > 전자세금계산서 > 매입 수집 — [실시간 내역수집] 클릭 → 목록 로드 대기 → [검색결과 다운로드](엑셀) 저장.
// ego-lite(ego-browser) 전용 스크립트. 실행: `ego-browser nodejs < scripts/popbill-fetch.mjs` (scripts/popbill-cycle.sh 가 호출).
//   · 팝빌 로그인은 ego-lite 프로필에 남아 있는 세션을 그대로 쓴다(아이디·비밀번호를 다루지 않음). 로그아웃 상태면 {ok:false, reason:"login"} 으로 끝내고 사람이 다시 로그인.
//   · 환경변수·인자를 못 받으므로 설정은 아래 상수. 결과는 마지막 줄 JSON 한 줄로 출력(래퍼가 파싱).
//   · 2026-10-28 탐색 기록: /App/NTSCrawling/Taxinvoice/Purchases?DateType=WriteDate&StartDate&EndDate 로 기간 프리셋,
//     [실시간 내역수집] = POST __API_V1__/NTSCrawling/Taxinvoice/Purchase → JobID 폴링 → Summary/목록, 완료 후 URL 에 ?JobID= 가 붙고 [검색결과 다운로드] 버튼이 생긴다.

const LOOKBACK_DAYS = 30; // 작성일자 기준 오늘-30일 ~ 오늘 (업서트가 승인번호 기준이라 겹쳐도 안전)
const OUT_DIR = "/Users/soongonkim/ego/popbill-inbox";
const SPACE_NAME = "팝빌 매입 수집 자동";
const PAGE_URL = "https://www.popbill.com/App/NTSCrawling/Taxinvoice/Purchases";

const fs = await import("node:fs/promises");
const kst = (d) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const now = new Date();
const endDate = kst(now);
const startDate = kst(new Date(now.getTime() - LOOKBACK_DAYS * 86400 * 1000));
const stamp = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
await fs.mkdir(OUT_DIR, { recursive: true });

const result = { ok: false, reason: null, file: null, rows: null, startDate, endDate, spaceId: null };
const finish = async (page, extra) => {
  Object.assign(result, extra);
  if (!result.ok && page) {
    try { await page.screenshot({ path: `${OUT_DIR}/fail-${stamp}.png` }); result.screenshot = `${OUT_DIR}/fail-${stamp}.png`; } catch {}
  }
  console.log(JSON.stringify(result));
};

let task, page;
try {
  task = await taskSpace(SPACE_NAME);
  result.spaceId = task.spaceId;
  page = task.page("p1");
  await page.goto(`${PAGE_URL}?DateType=WriteDate&StartDate=${startDate}&EndDate=${endDate}`);
  await page.waitForLoadState();
  await page.waitForTimeout(2500);

  // 로그인 확인 — 로그인 페이지로 튕기거나 [실시간 내역수집] 버튼이 없으면 세션 만료로 본다
  //   (/App 레이아웃에는 로그아웃 링크가 없고 사용자 드롭다운만 있어 링크로는 판단 불가)
  const url = await page.url();
  const hasButton = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("실시간 내역수집")));
  if (/Login|SignIn|Member\/Login/i.test(url) || !hasButton) { await finish(page, { reason: "login", url }); process.exit(2); }

  // 실시간 내역수집(홈택스에서 가져오기) — POST …/NTSCrawling/Taxinvoice/Purchase → JobID 폴링 → Summary → 목록 GET.
  // 초기 화면에도 '조회된 내역이 없습니다' 가 떠 있어 문구로는 완료를 알 수 없다 → 목록 GET 응답(…/Purchase?JobID=…)을 기다린다.
  await page.cdp("Network.enable", {});
  await page.events();
  await page.click('loc=role:button[name*="실시간 내역수집"]', { label: "run realtime collection" });
  await page.waitForURL(/JobID=/, { timeout: 90_000 });
  const deadline = Date.now() + 180_000;
  let listSeen = false;
  while (Date.now() < deadline && !listSeen) {
    const ev = await page.events();
    listSeen = ev.some((e) => e.method === "Network.responseReceived" && /__API_V1__\/NTSCrawling\/Taxinvoice\/Purchase\?JobID=/.test(e.params.response.url));
    if (!listSeen) await page.waitForTimeout(1000);
  }
  if (!listSeen) throw new Error("목록 응답 대기 시간 초과(180s)");
  // 그리드 렌더 대기 — ag-grid 행(.ag-row[row-index], 고정 컬럼 때문에 row-index 로 중복 제거) 또는 '조회된 내역이 없습니다'(보이는 것)
  const readGrid = () => page.evaluate(() => ({
    // 팝빌 그리드엔 .ag-body-viewport 가 없다. 하단 합계 고정행(ag-row-pinned, row-index b-0)은 뺀다.
    rows: new Set([...document.querySelectorAll(".ag-row[row-index]:not(.ag-row-pinned)")].map((r) => r.getAttribute("row-index")).filter((i) => /^\d+$/.test(i))).size,
    noData: [...document.querySelectorAll("*")].some((n) => n.children.length === 0 && (n.textContent || "").includes("조회된 내역이 없습니다") && n.offsetParent !== null),
  }));
  let grid = await readGrid();
  for (let i = 0; i < 15 && grid.rows === 0 && !grid.noData; i++) { await page.waitForTimeout(1000); grid = await readGrid(); }
  const rows = grid.rows;
  if (rows === 0) { await finish(null, { ok: true, rows: 0, reason: "empty" }); process.exit(0); }

  const dl = page.waitForEvent("download", { timeout: 60_000 });
  await page.click('loc=role:button[name*="검색결과 다운로드"]', { label: "download excel" });
  const d = await dl;
  const file = `${OUT_DIR}/popbill_buy_${stamp}.xlsx`;
  await d.saveAs(file);
  await finish(null, { ok: true, file, rows, suggested: d.suggestedFilename() });
  process.exit(0);
} catch (e) {
  await finish(page, { reason: "error", error: String(e).slice(0, 300) });
  process.exit(1);
}
