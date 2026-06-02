#!/usr/bin/env tsx
/**
 * 발주 레이더 수집 진입점 — 어댑터 실행 → 점수 → construction_project upsert.
 *
 * 사용법:
 *   npm run radar:collect               # 실제 수집·upsert
 *   npm run radar:collect -- --dry-run  # 수집·점수만, DB 미반영(요약 출력)
 *
 * 환경 변수(.env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   RLS 우회 upsert
 *   DATA_GO_KR_BUILDING_KEY                   건축HUB 건축인허가 (민간)
 *   DATA_GO_KR_NARA_KEY                       나라장터 입찰+낙찰 (관급)
 *   RADAR_SINCE_DAYS (선택, 기본 30)          최근 N일 갱신분
 *
 * cron(1일 1회): 트리거는 배포 시점 결정. 예) GitHub Actions —
 *   `on: schedule: - cron: '0 21 * * *'` (매일 06:00 KST) 에서 `npm run radar:collect`.
 *
 * ※ API 키가 아직 없으면 각 어댑터가 [] 반환 → 0건 upsert(무해). 파이프라인 배선 검증용.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runCollectors, scoreProjects, upsertProjects } from "../lib/radar/collectors";
import type { RadarRegion, RadarSource } from "../lib/radar/types";

const DRY_RUN = process.argv.includes("--dry-run");
const SINCE_DAYS = Number(process.env.RADAR_SINCE_DAYS ?? 30);
const envNum = (k: string) => {
  const v = process.env[k];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined; // 비수치(NaN) 입력은 무시 — isoDaysAgo(NaN) RangeError 방지
};

async function main() {
  // throttle/테스트 노브(선택): RADAR_ACTIVE_DAYS · RADAR_MAX_PAGES · RADAR_MAX_BJDONG
  const ctx = {
    sinceDays: SINCE_DAYS,
    activeWindowDays: envNum("RADAR_ACTIVE_DAYS"),
    maxPagesPerBjdong: envNum("RADAR_MAX_PAGES"),
    maxBjdongPerSigungu: envNum("RADAR_MAX_BJDONG"),
    naraWindowDays: envNum("RADAR_NARA_DAYS"),
    noticeMaxPages: envNum("RADAR_NOTICE_PAGES"),
    noticeWindowDays: envNum("RADAR_NOTICE_DAYS"),
    regions: process.env.RADAR_REGIONS
      ? (process.env.RADAR_REGIONS.split(",").map((s) => s.trim()).filter(Boolean) as RadarRegion[])
      : undefined,
    sources: process.env.RADAR_SOURCES
      ? (process.env.RADAR_SOURCES.split(",").map((s) => s.trim()).filter(Boolean) as RadarSource[])
      : undefined,
  };
  console.log(`[radar] 수집 시작${DRY_RUN ? " (dry-run)" : ""}`, ctx);

  const collected = await runCollectors(ctx);
  const scored = scoreProjects(collected);

  const byGrade = scored.reduce<Record<string, number>>((m, p) => {
    m[p.relevance_grade] = (m[p.relevance_grade] ?? 0) + 1;
    return m;
  }, {});
  console.log(`[radar] 정규화·점수 완료: ${scored.length}건`, byGrade);

  if (DRY_RUN) {
    console.log("[radar] dry-run — DB 미반영. 상위 5건:");
    for (const p of scored.slice(0, 5)) {
      console.log(
        `  · [${p.relevance_grade}] ${p.title} (${p.region}/${p.stage}) → ${p.contact_party}`,
      );
    }
    return;
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요 (.env.local). 또는 --dry-run 사용.",
    );
    process.exit(1);
  }

  const supabase: SupabaseClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { upserted } = await upsertProjects(supabase, scored);
  console.log(`[radar] upsert 완료: ${upserted}건`);
}

main().catch((e) => {
  console.error("[radar] 수집 실패:", e);
  process.exit(1);
});
