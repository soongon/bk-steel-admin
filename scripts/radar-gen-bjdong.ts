#!/usr/bin/env tsx
/**
 * 법정동코드 생성기 — 공식 전체자료에서 우리 8개 시군구의 bjdongCd(법정동 5자리, '존재'만)를
 * 추출해 lib/radar/bjdong-codes.ts 를 생성. 건축인허가 API가 bjdongCd 필수라 시군구당 목록 필요.
 *
 * 실행: npx tsx scripts/radar-gen-bjdong.ts
 * 출처: 행정표준코드관리시스템 법정동코드 전체자료 (FinanceData gist 미러).
 * 장점: API 쿼터 0, 동+읍면+리 완전(발견 스캔의 리 누락 없음).
 */

import { writeFileSync } from "node:fs";

const RAW =
  "https://gist.githubusercontent.com/FinanceData/4b0a6e1818cea9e77496e57b84bb4565/raw/1120cf8e0b94fd74863d3c8799aa353e194e828d/%EB%B2%95%EC%A0%95%EB%8F%99%EC%BD%94%EB%93%9C%EC%A0%84%EC%B2%B4%EC%9E%90%EB%A3%8C.txt";

// 경주 / 포항 남·북 / 울산 중·남·동·북·울주
const SIGUNGU = ["47130", "47111", "47113", "31110", "31140", "31170", "31200", "31710"];

(async () => {
  console.log("법정동코드 전체자료 내려받는 중…");
  const res = await fetch(RAW);
  if (!res.ok) throw new Error(`다운로드 실패 HTTP ${res.status}`);
  const text = await res.text();

  const map: Record<string, string[]> = {};
  for (const sg of SIGUNGU) map[sg] = [];

  for (const line of text.split("\n")) {
    const [code, , status] = line.split("\t");
    if (!code || !/^\d{10}$/.test(code)) continue; // 헤더·빈줄 스킵
    if (status?.trim() !== "존재") continue;
    const sg = code.slice(0, 5);
    if (!(sg in map)) continue;
    const bj = code.slice(5);
    if (bj === "00000") continue; // 시군구 자체 행 제외
    map[sg].push(bj);
  }

  const banner =
    "// 자동 생성 — scripts/radar-gen-bjdong.ts (출처: 행정표준코드 법정동코드 전체자료).\n" +
    "// 직접 수정 금지. 시군구코드 → 법정동코드(bjdongCd 5자리, '존재'만) 목록.\n\n";
  let body = "export const BJDONG_CODES: Record<string, string[]> = {\n";
  for (const sg of SIGUNGU) body += `  "${sg}": ${JSON.stringify(map[sg])},\n`;
  body += "};\n";
  writeFileSync("lib/radar/bjdong-codes.ts", banner + body);

  console.log("생성 완료 → lib/radar/bjdong-codes.ts");
  let total = 0;
  for (const sg of SIGUNGU) {
    console.log(`  ${sg}: ${map[sg].length}개`);
    total += map[sg].length;
  }
  console.log(`  합계: ${total}개 법정동`);
})().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
