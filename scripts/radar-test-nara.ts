#!/usr/bin/env tsx
/** 나라장터 어댑터 격리 테스트(수집+점수) — 건축 호출 없이 관급만. 사용: npx tsx scripts/radar-test-nara.ts [days] */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { naraBidCollector } from "../lib/radar/collectors/naraBid";
import { scoreProjects } from "../lib/radar/collectors";

(async () => {
  const days = Number(process.argv[2] ?? 7);
  console.log(`나라장터 테스트 — 최근 ${days}일, 경주·포항·울산`);
  const collected = await naraBidCollector.collect({
    sinceDays: 0,
    regions: ["gyeongju", "pohang", "ulsan"],
    naraWindowDays: days,
  });
  const scored = scoreProjects(collected);

  const tally = (k: "stage" | "region" | "relevance_grade" | "usage") =>
    scored.reduce<Record<string, number>>((m, p) => {
      const v = String(p[k]);
      m[v] = (m[v] || 0) + 1;
      return m;
    }, {});
  console.log("총:", scored.length);
  console.log("  단계:", JSON.stringify(tally("stage")));
  console.log("  등급:", JSON.stringify(tally("relevance_grade")));
  console.log("  공종:", JSON.stringify(tally("usage")));
  console.log("  권역:", JSON.stringify(tally("region")));

  console.log("\n상위 낙찰(A/B):");
  scored
    .filter((p) => p.stage === "awarded" && p.relevance_grade !== "C")
    .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
    .slice(0, 8)
    .forEach((p) =>
      console.log(
        `  [${p.relevance_grade}] ${p.title} → ${p.contact_party}${p.est_amount ? ` (${Math.round(p.est_amount / 1e8)}억)` : ""}`,
      ),
    );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
