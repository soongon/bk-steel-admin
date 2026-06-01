#!/usr/bin/env tsx
/** 나라장터 어댑터 격리 테스트 — 건축 호출 없이 관급만. 사용: npx tsx scripts/radar-test-nara.ts [days] */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { naraBidCollector } from "../lib/radar/collectors/naraBid";
import type { CollectedProject } from "../lib/radar/types";

(async () => {
  const days = Number(process.argv[2] ?? 7);
  console.log(`나라장터 테스트 — 최근 ${days}일, 경주·포항·울산`);
  const res = await naraBidCollector.collect({
    sinceDays: 0,
    regions: ["gyeongju", "pohang", "ulsan"],
    naraWindowDays: days,
  });
  const tally = (k: "stage" | "region") =>
    res.reduce<Record<string, number>>((m, p) => {
      const v = String(p[k]);
      m[v] = (m[v] || 0) + 1;
      return m;
    }, {});
  console.log("총:", res.length, "| 단계:", JSON.stringify(tally("stage")), "| 권역:", JSON.stringify(tally("region")));

  const show = (p: CollectedProject) =>
    console.log(`  [${p.region}] ${p.title} → ${p.contact_party}${p.est_amount ? ` (${p.est_amount.toLocaleString("ko-KR")}원)` : ""}`);
  console.log("\n낙찰(awarded) 샘플:");
  res.filter((x) => x.stage === "awarded").slice(0, 6).forEach(show);
  console.log("\n입찰공고(bid_notice) 샘플:");
  res.filter((x) => x.stage === "bid_notice").slice(0, 4).forEach(show);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
