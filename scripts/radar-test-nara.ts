#!/usr/bin/env tsx
/** 나라장터 어댑터 격리 테스트(수집·라벨만) — 건축 호출 없이 관급만. 사용: npx tsx scripts/radar-test-nara.ts [days] */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { naraBidCollector } from "../lib/radar/collectors/naraBid";
import { regionSuspect } from "../lib/radar/nara-rules";

(async () => {
  const days = Number(process.argv[2] ?? 7);
  console.log(`나라장터 테스트 — 최근 ${days}일, 경주·포항·울산`);
  const collected = await naraBidCollector.collect({
    sinceDays: 0,
    regions: ["gyeongju", "pohang", "ulsan"],
    naraWindowDays: days,
  });

  const tally = (k: "stage" | "region" | "usage") =>
    collected.reduce<Record<string, number>>((m, p) => {
      const v = String(p[k]);
      m[v] = (m[v] || 0) + 1;
      return m;
    }, {});
  console.log("총:", collected.length);
  console.log("  단계:", JSON.stringify(tally("stage")));
  console.log("  라벨:", JSON.stringify(tally("usage")));
  console.log("  권역:", JSON.stringify(tally("region")));
  // 현장지역(공고 raw)이 있으면 그것이 기준 — 수집기(matchRegionV2)와 같은 우선순위
  const suspects = collected.filter((p) => regionSuspect(p, (p.raw as Record<string, string> | null)?.cnstrtsiteRgnNm ?? null));
  console.log("  권역 오판 의심(재유입 검증, 0이어야 함):", suspects.length);
  for (const p of suspects.slice(0, 10)) console.log(`    ! ${p.region} | ${p.title} | ${p.ordering_org}`);

  console.log("\nRC 라벨 낙찰:");
  collected
    .filter((p) => p.stage === "awarded" && p.usage === "rc")
    .sort((a, b) => (b.stage_date ?? "").localeCompare(a.stage_date ?? ""))
    .slice(0, 10)
    .forEach((p) =>
      console.log(`  ${p.stage_date} ${p.region} | ${p.title} → ${p.contact_party}${p.est_amount ? ` (${(p.est_amount / 1e8).toFixed(1)}억)` : ""}`),
    );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
