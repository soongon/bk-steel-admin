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
 * [전환] 레이더 유래 견적(quote.source_project_id)·매출(sale.source_quote_id) — 4주 말 '레이더 유래 매출 ≥1' 아니면 A규칙 축소.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { addrRegion } from "../lib/radar/nara-rules";
import { kstToday } from "../lib/radar/radar-data";
import { RESULT_REFUSED, RESULT_UNREACHABLE, extractRadarId, normalizeResultCode } from "../lib/radar/v2-rules";

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
  const start = process.env.RADAR_CAMPAIGN_START ?? "2026-10-07";
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
  // 견적: 출처가 레이더인 견적(삭제 포함 — 수주 뒤 견적을 지워도 그 매출은 레이더 유래로 센다)
  const allQuotes = await fetchAll<{ id: string; status: string; deleted_at: string | null }>((a, b) =>
    sb.from("quote").select("id, status, deleted_at").not("source_project_id", "is", null).order("id").range(a, b) as never,
  );
  const quotes = allQuotes.filter((q) => !q.deleted_at);
  const sales: Array<{ id: string; total_krw: number }> = [];
  for (let i = 0; i < allQuotes.length; i += 100) {
    const part = allQuotes.slice(i, i + 100).map((q) => q.id);
    const { data, error } = await sb.from("sale").select("id, total_krw").in("source_quote_id", part).is("deleted_at", null);
    if (error) throw new Error(error.message);
    sales.push(...((data ?? []) as typeof sales));
  }
  // 참고: 레이더에 연결된(★) 거래처의 캠페인 기간 매출 — 견적 없이 평소 매출 폼으로 들어온 경우(연결 시점은 기록 안 됨)
  const linked = await fetchAll<{ linked_partner_id: string }>((a, b) =>
    sb.from("construction_project").select("linked_partner_id").not("linked_partner_id", "is", null).order("id").range(a, b) as never,
  );
  const linkedPids = [...new Set(linked.map((l) => l.linked_partner_id))];
  const saleIds = new Set(sales.map((x) => x.id));
  let linkedSales = 0;
  for (let i = 0; i < linkedPids.length; i += 100) {
    const { data, error } = await sb.from("sale").select("id").in("partner_id", linkedPids.slice(i, i + 100)).is("deleted_at", null).gte("ordered_on", start);
    if (error) throw new Error(error.message);
    linkedSales += ((data ?? []) as Array<{ id: string }>).filter((x) => !saleIds.has(x.id)).length;
  }
  const st = (s: string) => quotes.filter((q) => q.status === s).length;
  console.log("[전환 — 레이더 유래]");
  console.log(`  견적 ${quotes.length}건(작성 ${st("draft")} · 발송 ${st("sent")} · 수주 ${st("won")}) · 매출 ${sales.length}건 ${Math.round(sales.reduce((s, x) => s + Number(x.total_krw), 0)).toLocaleString("ko-KR")}원`);
  console.log(`  참고: ★ 연결 거래처(${linkedPids.length}곳)의 캠페인 기간 매출(견적 경유 제외) ${linkedSales}건 — 기존 거래처 매출이 섞일 수 있어 판정엔 넣지 않음`);
  console.log(`  ▶ 4주 말 기준: 레이더 유래 매출 ${sales.length >= 1 ? "≥1 — 유지" : "0 — A규칙 축소 검토"}${days < 28 ? `  ※ 아직 ${days}일째` : ""}`);
  if (unmapped) console.log(`\n⚠ 레이더 행에 연결할 수 없는 기록 ${unmapped}건(메모의 id 확인) — radar:v2:export 경고 참고`);
}

main().catch((e) => { console.error("[judge] 실패:", e); process.exit(1); });
