#!/usr/bin/env tsx
/**
 * 발주 레이더 v2 — D10 판정·4주 말 점검 집계(읽기 전용). 기획안 §9 D10·§11-11.
 *
 *   npm run radar:v2:judge                                   # 캠페인 시작 2026-10-07 ~ 오늘(KST)
 *   RADAR_CAMPAIGN_START=2026-10-07 npm run radar:v2:judge
 *
 * [전화] 관급 낙찰사 계정 — 영업내역(레이더 연결 + 메모 "레이더 {id}" 미연결) 결과를 정규화해 계정 단위로 집계.
 *   판정: 견적 요청 계정 ≥3 → 전화 탭 구현(D11) / 2 → 2주 연장 / 0~1 → A규칙(경주 소재) 폐기, ★·RC만.
 * [방문] 민간 현장 — '현장 없음' 비율(표지판 가정), 담당자 확보율, 단독주택 60~150㎡ 제외율(하한 재조정).
 * [전환] 레이더 유래 견적(quote.source_project_id)·매출(취소 제외) = 레이더 견적 경유(sale.source_quote_id)
 *   + [거래처로]로 만든 거래처(partner.source_project_id) + 캠페인 중, 레이더가 먼저 보여준 뒤 등록된 ★ 거래처의 캠페인 기간 매출
 *   — 4주 말 '레이더 유래 매출 ≥1' 아니면 A규칙 축소. 출처 기록 없는 마지막 묶음은 거래처별로 보여주고 뺀 보수 기준도 함께 낸다.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { addrRegion } from "../lib/radar/nara-rules";
import { kstToday } from "../lib/radar/radar-data";
import {
  RADAR_CAMPAIGN_START, RESULT_REFUSED, RESULT_UNREACHABLE, extractRadarId, normalizeResultCode, registeredBeforeRadar,
} from "../lib/radar/v2-rules";

type Log = {
  id: string; project_id: string | null; notes: string | null; result: string | null; contacted_on: string; created_at: string;
  channel: string | null; contact_person: string | null; contact_phone: string | null;
};
type Proj = {
  id: string; source: string; awardee_bizno: string | null; awarded_company: string | null; floor_area: number | null;
  dismissed_at: string | null; dismiss_reason: string | null; main_purps: string | null; awardee_addr: string | null;
};

async function fetchAll<T>(build: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let a = 0; ; a += 1000) {
    const { data, error } = await build(a, a + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

async function main() {
  const sb: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const start = process.env.RADAR_CAMPAIGN_START ?? RADAR_CAMPAIGN_START;
  const today = kstToday();
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  console.log(`발주 레이더 판정 집계 — 캠페인 ${start} ~ ${today} (${days}일째)\n`);

  // 기록: 레이더 연결분 + 메모 미연결분(기간 내)
  const logs = await fetchAll<Log>((a, b) =>
    sb.from("sales_log")
      .select("id, project_id, notes, result, contacted_on, created_at, channel, contact_person, contact_phone")
      .is("deleted_at", null).gte("contacted_on", start)
      .or("project_id.not.is.null,notes.ilike.%레이더%")
      .order("id").range(a, b) as never,
  );
  const pidOf = (l: Log) => l.project_id ?? extractRadarId(l.notes);
  const ids = [...new Set(logs.map(pidOf).filter((x): x is string => !!x))];
  const projs = new Map<string, Proj>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("construction_project")
      .select("id, source, awardee_bizno, awarded_company, floor_area, dismissed_at, dismiss_reason, main_purps:raw->>mainPurpsCdNm, awardee_addr:raw->>bidwinnrAdrs")
      .in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as unknown as Proj[]) projs.set(p.id, p);
  }
  const unmapped = logs.filter((l) => { const p = pidOf(l); return !p || !projs.has(p); }).length;

  // ── 전화(관급) ──
  const byAccount = new Map<string, { company: string | null; local: boolean; codes: Array<string | null> }>();
  let phoneLogs = 0;
  for (const l of logs) {
    const p = projs.get(pidOf(l) ?? "");
    if (!p || p.source !== "nara_bid") continue;
    phoneLogs += 1;
    const key = p.awardee_bizno ?? p.id;
    if (!byAccount.has(key)) byAccount.set(key, { company: p.awarded_company, local: addrRegion(p.awardee_addr) === "gyeongju", codes: [] });
    byAccount.get(key)!.codes.push(normalizeResultCode(l.result));
  }
  const accs = [...byAccount.values()];
  const has = (a: (typeof accs)[number], c: string) => a.codes.includes(c);
  const reached = accs.filter((a) => a.codes.some((c) => c === "견적 요청" || c === "다음에" || c === RESULT_REFUSED));
  const quoteReq = accs.filter((a) => has(a, "견적 요청"));
  console.log("[전화 — 관급 낙찰사 계정]");
  console.log(`  기록 ${phoneLogs}건 · 접촉 계정 ${accs.length} · 통화 성사(견적 요청·다음에·거절) ${reached.length} · 견적 요청 ${quoteReq.length} · 거절 ${accs.filter((a) => has(a, RESULT_REFUSED)).length} · 연락 불가 ${accs.filter((a) => has(a, RESULT_UNREACHABLE)).length}`);
  console.log(`  A(경주 소재) 견적 요청 ${quoteReq.filter((a) => a.local).length} · B(타지역 RC) 견적 요청 ${quoteReq.filter((a) => !a.local).length}`);
  for (const a of quoteReq) console.log(`    견적 요청: ${a.company ?? "-"}${a.local ? " (A)" : " (B)"}`);
  const n = quoteReq.length;
  const verdict = n >= 3 ? "전화 탭 구현(D11)" : n === 2 ? "2주 연장" : "A규칙(경주 소재 낙찰사) 폐기 — ★·RC 만 방문 탭 '전화' 소그룹으로";
  console.log(`  ▶ D10 판정(견적 요청 계정 ${n}): ${verdict}${days < 14 ? `  ※ 아직 ${days}일째 — 판정은 14일째에` : ""}`);
  console.log("    주의: '다음에'에는 부재가 섞여 통화 성사가 과대 계산될 수 있음\n");

  // ── 방문(민간) ──
  const visitLogs = logs.filter((l) => projs.get(pidOf(l) ?? "")?.source === "building_permit");
  const visitProjs = new Set(visitLogs.map((l) => pidOf(l)!));
  const codesV = visitLogs.map((l) => normalizeResultCode(l.result));
  const withContact = visitLogs.filter((l) => l.contact_person || l.contact_phone).length;
  const small = [...visitProjs].map((id) => projs.get(id)!).filter((p) => /단독주택/.test(p.main_purps ?? "") && (p.floor_area ?? 0) >= 60 && (p.floor_area ?? 0) < 150);
  const other = [...visitProjs].map((id) => projs.get(id)!).filter((p) => !small.includes(p));
  const excl = (ps: Proj[]) => ps.filter((p) => p.dismissed_at).length;
  console.log("[방문 — 민간 현장]");
  console.log(`  기록 ${visitLogs.length}건 · 현장 ${visitProjs.size}곳 · 결과: 견적 요청 ${codesV.filter((c) => c === "견적 요청").length} · 다음에 ${codesV.filter((c) => c === "다음에").length} · 현장 없음 ${codesV.filter((c) => c === RESULT_UNREACHABLE).length} · 거절 ${codesV.filter((c) => c === RESULT_REFUSED).length}`);
  console.log(`  '현장 없음' 비율 ${pct(codesV.filter((c) => c === RESULT_UNREACHABLE).length, visitLogs.length)} (표지판 가정 점검) · 담당자 확보율 ${pct(withContact, visitLogs.length)}`);
  console.log(`  제외율: 단독주택 60~150㎡ ${pct(excl(small), small.length)}(${small.length}곳) vs 그 외 ${pct(excl(other), other.length)}(${other.length}곳) — 하한 재조정 근거\n`);

  // ── 전환 ──
  // 매출은 취소(status cancelled) 제외 — 앱의 매출·미수 뷰와 같은 기준
  // 견적: 출처가 레이더인 견적(삭제 포함 — 수주 뒤 견적을 지워도 그 매출은 레이더 유래로 센다)
  const allQuotes = await fetchAll<{ id: string; status: string; deleted_at: string | null }>((a, b) =>
    sb.from("quote").select("id, status, deleted_at").not("source_project_id", "is", null).order("id").range(a, b) as never,
  );
  const quotes = allQuotes.filter((q) => !q.deleted_at);
  const sales: Array<{ id: string; total_krw: number }> = [];
  for (let i = 0; i < allQuotes.length; i += 100) {
    const part = allQuotes.slice(i, i + 100).map((q) => q.id);
    const { data, error } = await sb.from("sale").select("id, total_krw").in("source_quote_id", part).is("deleted_at", null).neq("status", "cancelled");
    if (error) throw new Error(error.message);
    sales.push(...((data ?? []) as typeof sales));
  }
  const quoteSales = sales.length;
  const saleIds = new Set(sales.map((x) => x.id));

  // 레이더 유래 거래처 — ① [거래처로]로 만든 거래처(partner.source_project_id, 0074, 삭제 포함)
  //   ② 출처 기록은 없지만 캠페인 중에, 레이더가 그 업체를 먼저 보여준 뒤 등록된 ★ 거래처(전화 캠페인 뒤 거래처 메뉴 등록 등 —
  //      전화 탭엔 [거래처로]가 없다). '먼저 보여준 시각' = 삭제 안 된 ★ 행의 최초 수집, 낙찰 행은 낙찰 반영 시각(공고 땐 업체 미정).
  //   나머지 ★ 거래처는 참고(판정 제외).
  type Partner = { id: string; code: string; name: string; created_at: string };
  const radarPartners = await fetchAll<Partner>((a, b) =>
    sb.from("partner").select("id, code, name, created_at").not("source_project_id", "is", null).order("id").range(a, b) as never,
  );
  const radarPids = new Set(radarPartners.map((p) => p.id));
  type Star = { linked_partner_id: string; created_at: string; source: string; stage: string; stage_changed_at: string | null; deleted_at: string | null };
  const linked = await fetchAll<Star>((a, b) =>
    sb.from("construction_project").select("linked_partner_id, created_at, source, stage, stage_changed_at, deleted_at")
      .not("linked_partner_id", "is", null).order("id").range(a, b) as never,
  );
  const seenBy = new Map<string, string[]>();
  for (const l of linked) {
    if (radarPids.has(l.linked_partner_id)) continue;
    const seen = seenBy.get(l.linked_partner_id) ?? [];
    if (!l.deleted_at) seen.push(l.source === "nara_bid" && l.stage === "awarded" && l.stage_changed_at ? l.stage_changed_at : l.created_at);
    seenBy.set(l.linked_partner_id, seen);
  }
  const startMs = Date.parse(`${start}T00:00:00+09:00`);
  const campaignPs: Array<Partner & { firstSeen: string }> = [];
  const earlierPids: string[] = [];
  const starIds = [...seenBy.keys()];
  for (let i = 0; i < starIds.length; i += 100) {
    const { data, error } = await sb.from("partner").select("id, code, name, created_at").in("id", starIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as Partner[]) {
      const seen = seenBy.get(p.id) ?? [];
      if (Date.parse(p.created_at) >= startMs && seen.length > 0 && !registeredBeforeRadar(p.created_at, seen)) {
        campaignPs.push({ ...p, firstSeen: seen.reduce((m, x) => (Date.parse(x) < Date.parse(m) ? x : m)) });
      } else earlierPids.push(p.id);
    }
  }
  // 거래처들의 캠페인 기간 매출(견적 경유분과 중복 제외) — add 면 레이더 유래 매출에 더한다. 거래처별 건수·금액도 돌려준다.
  const partnerSales = async (pids: string[], add: boolean) => {
    const per = new Map<string, { n: number; krw: number }>();
    let n = 0;
    for (let i = 0; i < pids.length; i += 100) {
      const part = pids.slice(i, i + 100);
      const rows = await fetchAll<{ id: string; total_krw: number; partner_id: string }>((a, b) =>
        sb.from("sale").select("id, total_krw, partner_id").in("partner_id", part)
          .is("deleted_at", null).neq("status", "cancelled").gte("ordered_on", start).order("id").range(a, b) as never,
      );
      for (const x of rows) {
        if (saleIds.has(x.id)) continue;
        n += 1;
        const e = per.get(x.partner_id) ?? { n: 0, krw: 0 };
        e.n += 1;
        e.krw += Number(x.total_krw);
        per.set(x.partner_id, e);
        if (!add) continue;
        saleIds.add(x.id);
        sales.push(x);
      }
    }
    return { n, per };
  };
  const made = await partnerSales([...radarPids], true);
  const campaign = await partnerSales(campaignPs.map((p) => p.id), true);
  const earlier = await partnerSales(earlierPids, false);

  const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
  const kstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
  const keepA = (n: number) => (n >= 1 ? "≥1 — 유지" : "0 — A규칙 축소 검토");
  const st = (s: string) => quotes.filter((q) => q.status === s).length;
  console.log("[전환 — 레이더 유래]");
  console.log(`  견적 ${quotes.length}건(작성 ${st("draft")} · 발송 ${st("sent")} · 수주 ${st("won")})`);
  console.log(`  거래처: 레이더에서 만든 ${radarPids.size}곳 · 캠페인 중 등록된 ★ ${campaignPs.length}곳 · 그 밖의 ★ ${earlierPids.length}곳`);
  console.log(
    `  매출 ${sales.length}건 ${won(sales.reduce((s, x) => s + Number(x.total_krw), 0))}원` +
      ` (레이더 견적 경유 ${quoteSales} · 레이더에서 만든 거래처 ${made.n} · 캠페인 중 등록된 ★ 거래처 ${campaign.n}, 취소 제외)`,
  );
  for (const p of radarPartners) {
    const e = made.per.get(p.id);
    if (e) console.log(`    · 레이더에서 만든 ${p.code} ${p.name} (${kstDate(p.created_at)} 등록) — 매출 ${e.n}건 ${won(e.krw)}원`);
  }
  for (const p of campaignPs) {
    const e = campaign.per.get(p.id);
    if (e) console.log(`    · 캠페인 중 등록된 ★ ${p.code} ${p.name} (${kstDate(p.created_at)} 등록, 레이더 첫 표시 ${kstDate(p.firstSeen)}) — 매출 ${e.n}건 ${won(e.krw)}원`);
  }
  console.log(`  참고: 그 밖의 ★ 거래처(캠페인 전 등록·레이더가 보여주기 전부터 거래처·★ 행 모두 삭제)의 캠페인 기간 매출 ${earlier.n}건 — 판정엔 넣지 않음`);
  console.log(`  ▶ 4주 말 기준: 레이더 유래 매출 ${keepA(sales.length)}${days < 28 ? `  ※ 아직 ${days}일째` : ""}`);
  if (campaign.n > 0) {
    console.log(`    보수 기준(캠페인 중 등록된 ★ 거래처 제외 — 출처 기록 없이 우연히 겹친 곳일 수 있음): ${keepA(quoteSales + made.n)}`);
  }
  if (unmapped) console.log(`\n⚠ 레이더 행에 연결할 수 없는 기록 ${unmapped}건(메모의 id 확인) — radar:v2:export 경고 참고`);
}

main().catch((e) => { console.error("[judge] 실패:", e); process.exit(1); });
