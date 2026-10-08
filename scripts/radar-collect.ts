#!/usr/bin/env tsx
/**
 * 발주 레이더 수집 진입점 — 어댑터 실행 → 기존 행 병합 → construction_project upsert → 수기 기록 연결 → 알림.
 *
 * 사용법:
 *   npm run radar:collect               # 실제 수집·upsert
 *   npm run radar:collect -- --dry-run  # 수집·정규화만, DB 미반영(요약 출력)
 *
 * 환경 변수(.env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   RLS 우회 upsert
 *   DATA_GO_KR_BUILDING_KEY                   건축HUB 건축인허가 (민간)
 *   DATA_GO_KR_NARA_KEY                       나라장터 입찰+낙찰 (관급, 없으면 BUILDING 키 폴백)
 *   RADAR_SOURCES / RADAR_REGIONS             소스·권역 부분 실행 (cron: .github/workflows/radar-*.yml) — 오타면 즉시 실패
 *   RADAR_NARA_DAYS · RADAR_ACTIVE_DAYS · RADAR_MAX_PAGES · RADAR_MAX_BJDONG   throttle 노브
 *
 * 실패 처리: 어댑터는 창·법정동 단위 부분 실패에도 계속 진행한다. 실행한 소스가 0건인데 오류가 있으면
 * 종료코드 1(cron 빨간불) + 카카오워크 경고. 부분 실패는 알림에 '⚠ 오류 n건'으로 남긴다.
 * 알림: "오늘 방문 N · 신규 n · 단계변경 n · 링크" — N은 화면 '오늘'과 같은 함수(loadVisitRows).
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existingNaraLookup, runCollectors, upsertProjects } from "../lib/radar/collectors";
import { notifyKakaoWork, adminUrl } from "../lib/kakaowork";
import { RADAR_REGIONS, RADAR_SOURCES, type RadarRegion, type RadarSource } from "../lib/radar/types";
import { kstToday, linkPartnersByBizno, linkSalesLogNotes, loadVisitRows } from "../lib/radar/radar-data";

const DRY_RUN = process.argv.includes("--dry-run");
const SINCE_DAYS = Number(process.env.RADAR_SINCE_DAYS ?? 30);
const envNum = (k: string) => {
  const v = process.env[k];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined; // 비수치(NaN) 입력은 무시 — isoDaysAgo(NaN) RangeError 방지
};
/** 쉼표 목록 env → 허용값 검증. 오타(예: gyongju)가 '0건 성공'으로 묻히지 않게 즉시 실패. */
function envList<T extends string>(name: string, allowed: readonly T[]): T[] | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const vals = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = vals.filter((v) => !(allowed as readonly string[]).includes(v));
  if (bad.length > 0) throw new Error(`${name} 알 수 없는 값: ${bad.join(", ")} (허용: ${allowed.join(", ")})`);
  return vals as T[];
}

async function main() {
  const errors = new Map<RadarSource, string[]>();
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase: SupabaseClient | null =
    url && serviceKey ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

  const ctx = {
    sinceDays: SINCE_DAYS,
    activeWindowDays: envNum("RADAR_ACTIVE_DAYS"),
    maxPagesPerBjdong: envNum("RADAR_MAX_PAGES"),
    maxBjdongPerSigungu: envNum("RADAR_MAX_BJDONG"),
    naraWindowDays: envNum("RADAR_NARA_DAYS"),
    regions: envList<RadarRegion>("RADAR_REGIONS", RADAR_REGIONS),
    sources: envList<RadarSource>("RADAR_SOURCES", RADAR_SOURCES),
    onError: (source: RadarSource, message: string) => {
      if (!errors.has(source)) errors.set(source, []);
      errors.get(source)!.push(message);
    },
    // 공고가 수집 창 밖인 낙찰 → DB 기존 공고 행으로 권역 판정(읽기 전용이라 dry-run 에도 사용)
    existingNaraByKey: supabase ? existingNaraLookup(supabase) : undefined,
  };
  const { onError: _onError, existingNaraByKey: _lookup, ...printable } = ctx;
  void _onError;
  void _lookup;
  console.log(`[radar] 수집 시작${DRY_RUN ? " (dry-run)" : ""}`, printable);

  const collected = await runCollectors(ctx);
  const bySource = new Map<RadarSource, number>();
  for (const p of collected) bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1);
  const byLabel = collected.reduce<Record<string, number>>((m, p) => {
    const k = `${p.source}/${p.stage}/${p.usage ?? "-"}`;
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  console.log(`[radar] 정규화 완료: ${collected.length}건`, byLabel);
  const errorCount = [...errors.values()].reduce((s, xs) => s + xs.length, 0);
  // 실행한 소스가 0건인데 오류가 있으면 = 장애(키 만료·쿼터·API 다운)
  const ran = (ctx.sources ?? [...RADAR_SOURCES]) as RadarSource[];
  const deadSources = ran.filter((s) => (bySource.get(s) ?? 0) === 0 && (errors.get(s)?.length ?? 0) > 0);
  if (errorCount > 0) {
    console.warn(`[radar] 수집 오류 ${errorCount}건`, Object.fromEntries([...errors].map(([k, v]) => [k, v.length])));
  }

  if (DRY_RUN) {
    console.log("[radar] dry-run — DB 미반영. 상위 8건:");
    for (const p of collected.slice(0, 8)) {
      console.log(`  · ${p.title} (${p.region}/${p.stage}/${p.usage ?? "-"}) → ${p.contact_party}`);
    }
    if (deadSources.length > 0) process.exitCode = 1;
    return;
  }

  if (!supabase) {
    console.error("✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요 (.env.local). 또는 --dry-run 사용.");
    process.exit(1);
  }

  const stats = await upsertProjects(supabase, collected);
  console.log(`[radar] upsert 완료:`, stats);

  // ★ 거래처 자동 연결 — 사업자번호가 같은 거래처를 새 낙찰 행에 연결(멱등)
  try {
    const star = await linkPartnersByBizno(supabase);
    if (star.linked > 0) console.log(`[radar] ★ 거래처 연결: ${star.linked}행`);
  } catch (e) {
    console.warn("[radar] ★ 연결 실패(계속):", (e as Error).message);
  }

  // 영업내역 페이지 수기 기록(메모 "레이더 {id}") → project_id 연결(멱등). D10 판정 집계·수신거부용.
  let linkWarn = "";
  try {
    const link = await linkSalesLogNotes(supabase);
    if (link.found + link.noId > 0) {
      console.log(
        `[radar] 수기 기록 연결: ${link.linked}/${link.found} · 제외 처리 ${link.dismissed}행 · id 없는 메모 ${link.noId}` +
          (link.failed.length ? ` · 실패 ${link.failed.length}` : ""),
      );
      for (const f of link.failed) console.warn(`  ! sales_log ${f.log_id}: ${f.reason}`);
    }
    // 연결 실패·id 없는 메모는 수신거부가 적용되지 않을 수 있다 → 알림에도 남긴다
    if (link.failed.length || link.noId) linkWarn = `\n⚠ 수기 기록 연결 실패 ${link.failed.length} · id 없는 레이더 메모 ${link.noId}`;
  } catch (e) {
    console.warn("[radar] 수기 기록 연결 실패(계속):", (e as Error).message);
  }

  // 카카오워크 알림 — 오늘 할 일 기준. KAKAOWORK_WEBHOOK_URL 미설정이면 무동작.
  if (stats.upserted > 0 || errorCount > 0 || linkWarn) {
    let visitLine = "";
    try {
      const rows = await loadVisitRows(supabase, kstToday());
      visitLine = `오늘 방문 ${rows.filter((r) => r.status === "today").length}건 · `;
    } catch (e) {
      console.warn("[radar] 방문 집계 실패(알림은 계속):", (e as Error).message);
    }
    const warn =
      errorCount > 0
        ? `\n⚠ 수집 오류 ${errorCount}건 (${[...errors].map(([k, v]) => `${k} ${v.length}`).join(", ")})` +
          (deadSources.length ? ` — ${deadSources.join(", ")} 전체 실패` : "")
        : "";
    await notifyKakaoWork(
      `🚧 발주 레이더 동기화 — ${visitLine}신규 ${stats.inserted} · 단계변경 ${stats.stageChanged}` +
        (stats.skippedRegress ? ` · 낙찰 역행 차단 ${stats.skippedRegress}` : "") +
        warn +
        linkWarn +
        `\n${adminUrl("/radar")}`,
    );
  }
  if (deadSources.length > 0) {
    console.error(`[radar] 소스 전체 실패: ${deadSources.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("[radar] 수집 실패:", e);
  process.exit(1);
});
