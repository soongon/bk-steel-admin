#!/usr/bin/env tsx
/**
 * 발주 레이더 v2 — 기존 적재 행 정리(기획안 §7 "기존 5,632행 처리", §9 D2). 물리 삭제 없음. 멱등(여러 번 돌려도 안전).
 *
 *   npm run radar:v2:cleanup:dry   # 변경 없이 대상·건수만 출력
 *   npm run radar:v2:cleanup       # 실제 반영
 *   … -- --restore-deleted-at=2026-10-06T06:30:04.024Z   # 그 시각에 soft delete 된 관급 행 중 새 판정상 정상인 행 복구
 *
 * 0) (선택) 과삭제 복구 — 지정 시각 삭제분을 새 판정(현장지역 우선)으로 재평가해 정상이면 deleted_at 해제
 * 1) 권역 오판 soft delete — regionSuspect(행, 현장지역) ∧ 수집기 판정(matchRegionV2) 모두 거부한 행만. 제외된 행은 건드리지 않음
 * 2) 관급 라벨 재계산 — usage ← rc·civil·non_steel(표시용; 전화 규칙은 읽는 시점에 계산). 비공사는 soft delete
 * 3) ★ 백필 — partner.business_no = awardee_bizno → linked_partner_id
 * 4) 수기 기록 연결 — sales_log 메모 "레이더 {id}" → project_id (수집 cron 도 매일 수행)
 * 5) 검증 리포트 — 화면과 같은 로더로 전화 계정·방문 행 수(기획안 D2: 전화 32±3 · 방문 108 · 공란 0 · 마스킹 1)
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { matchRegionV2, naraLabel, regionSuspect } from "../lib/radar/nara-rules";
import { kstToday, linkPartnersByBizno, linkSalesLogNotes, loadPhoneAccounts, loadVisitRows } from "../lib/radar/radar-data";

const DRY = process.argv.includes("--dry-run");
const RESTORE_AT = process.argv.find((a) => a.startsWith("--restore-deleted-at="))?.split("=")[1] ?? null;
const CHUNK = 100;

type Res<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
async function fetchAll<T>(build: (from: number, to: number) => Res<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function updateIn(sb: SupabaseClient, patch: Record<string, unknown>, ids: string[]) {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await sb.from("construction_project").update(patch).in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`construction_project update 실패: ${error.message}`);
  }
}

type NaraRow = {
  id: string; source_key: string; title: string; ordering_org: string | null; region: string; stage: string; usage: string | null;
  awardee_bizno: string | null; linked_partner_id: string | null; deleted_at: string | null; dismissed_at: string | null;
  site: string | null; cnstwk_type: string | null; main_cnstty: string | null;
};
const NARA_COLS =
  "id, source_key, title, ordering_org, region, stage, usage, awardee_bizno, linked_partner_id, deleted_at, dismissed_at, site:raw->>cnstrtsiteRgnNm, cnstwk_type:raw->>mtltyAdvcPsblYnCnstwkNm, main_cnstty:raw->>mainCnsttyNm";
/** 수집기가 받아들이지 않는 행만 권역 오판으로 본다 — 휴리스틱(regionSuspect) ∧ 수집기 판정(matchRegionV2) 모두 거부. */
const isRegionMisfit = (r: NaraRow) =>
  regionSuspect(r, r.site) !== null && matchRegionV2({ siteRegion: r.site, title: r.title, orderingOrg: r.ordering_org }) === null;
const labelOf = (r: NaraRow) => naraLabel(r.stage === "bid_notice" ? `${r.title} ${r.main_cnstty ?? ""}` : r.title, r.cnstwk_type);

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요(.env.local)");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const nowIso = new Date().toISOString();
  console.log(`[cleanup] ${DRY ? "DRY-RUN" : "실행"} ${nowIso}`);

  // ── 0) 과삭제 복구(선택) ───────────────────────────────────
  if (RESTORE_AT) {
    // v2 정리 시각만 허용 — 7월 v1 정리(차수 접미 구키 중복 제거)분을 실수로 되살리지 않게.
    if (RESTORE_AT < "2026-10-06" && !process.argv.includes("--force")) {
      throw new Error(`--restore-deleted-at=${RESTORE_AT}: v2(2026-10-06~) 정리 시각만 허용(--force 로 무시)`);
    }
    const deleted = await fetchAll<NaraRow>((a, b) =>
      sb.from("construction_project").select(NARA_COLS).eq("source", "nara_bid").eq("deleted_at", RESTORE_AT).order("id").range(a, b) as unknown as Res<NaraRow>,
    );
    const back = deleted.filter((r) => !isRegionMisfit(r) && labelOf(r) !== null && !/-\d{3}$/.test(r.source_key));
    console.log(`\n0) 과삭제 복구 — ${RESTORE_AT} 삭제 ${deleted.length}건 중 새 판정 정상 ${back.length}건`);
    for (const r of back) {
      const region = r.site ? matchRegionV2({ siteRegion: r.site, title: r.title, orderingOrg: r.ordering_org }) : null;
      console.log(`   + ${r.region}${region && region !== r.region ? `→${region}` : ""} ${r.stage} | ${r.title} | 현장 ${r.site ?? "—"}`);
      if (!DRY) {
        const { error } = await sb.from("construction_project").update({ deleted_at: null, ...(region ? { region } : {}) }).eq("id", r.id);
        if (error) throw new Error(error.message);
      }
    }
  }

  // ── 1·2) 관급 행 — 권역 오판 soft delete + 라벨 재계산 ───────
  const nara = await fetchAll<NaraRow>((a, b) =>
    sb.from("construction_project").select(NARA_COLS).eq("source", "nara_bid").is("deleted_at", null).order("id").range(a, b) as unknown as Res<NaraRow>,
  );
  // 사람이 제외한 행(dismissed_at)은 지우지 않는다 — 수신거부·처분 이력 보존
  const suspects = nara
    .filter((r) => !r.dismissed_at && isRegionMisfit(r))
    .map((r) => ({ r, why: regionSuspect(r, r.site) }));
  const whyCount: Record<string, number> = {};
  for (const x of suspects) whyCount[x.why!.replace(/\(.*/, "")] = (whyCount[x.why!.replace(/\(.*/, "")] ?? 0) + 1;
  console.log(`\n1) 권역 오판 의심 ${suspects.length}건 (활성 관급 ${nara.length}) — soft delete`, whyCount);
  for (const x of suspects.slice(0, 12)) console.log(`   - [${x.why}] ${x.r.region} ${x.r.stage} | ${x.r.title} | ${x.r.ordering_org}`);
  if (suspects.length > 12) console.log(`   … 외 ${suspects.length - 12}건`);
  const suspectIds = new Set(suspects.map((x) => x.r.id));

  const relabel: Record<string, string[]> = { rc: [], civil: [], non_steel: [] };
  const nonConstruction: string[] = [];
  for (const r of nara) {
    if (suspectIds.has(r.id)) continue;
    const label = labelOf(r);
    if (!label) { if (!r.dismissed_at) nonConstruction.push(r.id); continue; }
    if (r.usage !== label) relabel[label].push(r.id);
  }
  console.log(`\n2) 라벨 재계산 — 변경: rc ${relabel.rc.length} · civil ${relabel.civil.length} · non_steel ${relabel.non_steel.length} · 비공사(soft delete) ${nonConstruction.length}`);
  if (!DRY) {
    await updateIn(sb, { deleted_at: nowIso }, [...suspectIds]);
    await updateIn(sb, { deleted_at: nowIso }, nonConstruction);
    for (const [label, ids] of Object.entries(relabel)) await updateIn(sb, { usage: label }, ids);
  }
  const removed = new Set([...suspectIds, ...nonConstruction]);
  const kept = nara.filter((r) => !removed.has(r.id));

  // ── 3) ★ 백필 — 수집 cron·거래처 저장과 같은 함수(linkPartnersByBizno) ─────────
  void kept;
  const star = await linkPartnersByBizno(sb, { dryRun: DRY });
  console.log(`\n3) ★ 백필 — 사업자번호 보유 거래처 ${star.partners}곳 · ${DRY ? "연결 대상" : "연결"} ${star.linked}행`);

  // ── 4) 수기 기록 연결 ────────────────────────────────────
  const link = await linkSalesLogNotes(sb, { dryRun: DRY });
  console.log(
    `\n4) 영업내역 메모 → project_id: 대상 ${link.found}건 · id 없는 '레이더' 메모 ${link.noId}건` +
      (DRY ? "" : ` · 연결 ${link.linked} · 제외 처리 ${link.dismissed}행 · 실패 ${link.failed.length}`),
  );
  for (const f of link.failed) console.log(`   ! sales_log ${f.log_id}: ${f.reason}`);

  // ── 5) 검증 리포트(화면과 같은 로더) ─────────────────────────
  const today = kstToday();
  const phone = await loadPhoneAccounts(sb, today);
  const accs = phone.accounts;
  const visits = await loadVisitRows(sb, today);
  console.log(`\n5) 검증(${today}${DRY ? ", 반영 전 DB 기준" : ""}) — 기획안 D2: 전화 32±3 · 방문 108 · 필수 5필드 공란 0 · 창 안 마스킹 1`);
  console.log(
    `   전화 계정 ${accs.length} (A ${accs.filter((a) => a.match === "local").length} · B ${accs.filter((a) => a.match === "rc").length} · A∧B ${accs.filter((a) => a.match === "both").length})` +
      ` · ★ ${accs.filter((a) => a.partnerName).length} · 필수 5필드 공란 ${accs.filter((a) => a.missing.length).length} · 창 안 마스킹 ${phone.maskedInWindow}`,
  );
  console.log(
    `   방문 행 ${visits.length} (오늘 ${visits.filter((r) => r.status === "today").length} · 착공 ${visits.filter((r) => r.stage === "construction_start").length} · 허가 ${visits.filter((r) => r.stage === "permit").length})` +
      ` · 거래처 사업자번호 ${phone.partnersWithBizno}/${phone.partnersTotal}`,
  );
  console.log(`\n[cleanup] ${DRY ? "DRY-RUN 종료 — 변경 없음" : "완료"}`);
}

main().catch((e) => { console.error("[cleanup] 실패:", e); process.exit(1); });
