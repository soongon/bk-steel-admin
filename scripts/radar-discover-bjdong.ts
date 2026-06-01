#!/usr/bin/env tsx
/**
 * 시군구별 유효 법정동코드(bjdongCd) 발견 — 건축인허가 API가 bjdongCd 필수라
 * 시군구당 법정동 목록이 필요. NNN00(읍면동+리00)을 스캔해 데이터 있는 코드를 추린다.
 *
 * 사용: npx tsx scripts/radar-discover-bjdong.ts <sigunguCd> [maxNNN=460]
 * 출력: 유효 코드 + 동명 + 건수, 마지막에 paste용 배열.
 * 주의: 1회성 셋업(API 호출 다수). 리(里) 단위는 NNN00만 보므로 일부 누락 가능 → 후속 보정.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });

const KEY = process.env.DATA_GO_KR_BUILDING_KEY;
if (!KEY) {
  console.error("✗ DATA_GO_KR_BUILDING_KEY 없음");
  process.exit(1);
}

const BASE = "https://apis.data.go.kr/1613000/ArchPmsHubService/getApBasisOulnInfo";
const sigunguCd = process.argv[2] ?? "47130";
const maxNNN = Number(process.argv[3] ?? 460);

async function probe(bjdongCd: string): Promise<{ total: number; addr: string } | null> {
  const u = new URL(BASE);
  u.searchParams.set("serviceKey", KEY!);
  u.searchParams.set("sigunguCd", sigunguCd);
  u.searchParams.set("bjdongCd", bjdongCd);
  u.searchParams.set("numOfRows", "1");
  u.searchParams.set("pageNo", "1");
  u.searchParams.set("_type", "json");
  const res = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  const t = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let j: any;
  try {
    j = JSON.parse(t);
  } catch {
    return null;
  }
  const body = j?.response?.body ?? j?.body;
  const total = Number(body?.totalCount ?? 0);
  let item = body?.items?.item;
  item = Array.isArray(item) ? item[0] : item;
  return { total, addr: item?.platPlc ?? "" };
}

(async () => {
  console.log(`스캔 시군구=${sigunguCd}, NNN=101..${maxNNN}\n`);
  const valid: string[] = [];
  for (let n = 101; n <= maxNNN; n++) {
    const code = `${n}00`;
    try {
      const r = await probe(code);
      if (r && r.total > 0) {
        valid.push(code);
        const dong = r.addr.split(" ").slice(0, 3).join(" ");
        console.log(`${code}  ${String(r.total).padStart(6)}건  ${dong}`);
      }
    } catch (e) {
      console.log(`${code}  error ${(e as Error).message}`);
    }
  }
  console.log(`\n총 ${valid.length}개. config 배열:`);
  console.log(JSON.stringify(valid));
})();
