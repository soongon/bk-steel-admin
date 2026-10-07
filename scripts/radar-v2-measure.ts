#!/usr/bin/env tsx
/**
 * 발주 레이더 v2 — 지금 화면·CSV가 보여줄 숫자 재측정(읽기 전용). 화면과 같은 로더·규칙(lib/radar/radar-data).
 *   npx tsx scripts/radar-v2-measure.ts                       # 오늘(KST)
 *   RADAR_MEASURE_TODAY=2026-10-06 npx tsx scripts/radar-v2-measure.ts
 * 기획안 D2 기준(2026-10-06): 전화 32±3 · 방문 108 · 필수 5필드 공란 0 · 창 안 마스킹 1.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { createClient } from "@supabase/supabase-js";
import { kstToday, loadPhoneAccounts, loadVisitRows } from "../lib/radar/radar-data";
import { BAND_LABEL, DISTANCE_BANDS } from "../lib/radar/v2-rules";

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const today = process.env.RADAR_MEASURE_TODAY ?? kstToday();
  console.log(`기준일 ${today}`);

  const phone = await loadPhoneAccounts(sb, today);
  const accs = phone.accounts;
  const n = (f: (a: (typeof accs)[number]) => boolean) => accs.filter(f).length;
  console.log(
    `\n[전화] 계정 ${accs.length} — A(경주 소재 30일)만 ${n((a) => a.match === "local")} · B(RC 90일)만 ${n((a) => a.match === "rc")} · A∧B ${n((a) => a.match === "both")}` +
      ` · ★ ${n((a) => !!a.partnerName)} · 필수 5필드 공란 ${n((a) => a.missing.length > 0)} · 창 안 마스킹 ${phone.maskedInWindow}` +
      ` · 거래처 사업자번호 ${phone.partnersWithBizno}/${phone.partnersTotal}`,
  );
  for (const a of accs.slice(0, 8)) {
    const w = a.awards[0];
    console.log(`   ${a.partnerName ? "★" : " "}${a.awards.some((x) => x.rc) ? "RC" : "  "} ${a.company} | ${w?.stage_date} ${w?.title}`);
  }

  const visits = await loadVisitRows(sb, today);
  const by = (f: (r: (typeof visits)[number]) => string) =>
    visits.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
  const todayRows = visits.filter((r) => r.status === "today");
  console.log(`\n[방문] 행 ${visits.length} — 상태 ${JSON.stringify(by((r) => r.status))} · 단계 ${JSON.stringify(by((r) => r.stage))}`);
  console.log(
    "   오늘 밴드(착공/허가): " +
      DISTANCE_BANDS.map((b) => {
        const rs = todayRows.filter((r) => r.band === b);
        return `${BAND_LABEL[b]} ${rs.filter((r) => r.stage === "construction_start").length}/${rs.filter((r) => r.stage === "permit").length}`;
      }).join(" · "),
  );
  console.log(`   읍면동 미추출 ${visits.filter((r) => !r.emd).length} · 제목 힌트 ${visits.filter((r) => r.titleHint).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
