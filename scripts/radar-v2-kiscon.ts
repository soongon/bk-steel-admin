#!/usr/bin/env tsx
/**
 * 전국건설업체정보(키스콘) API — 활용신청 확인 + 전화 마스킹 낙찰사 보완 채움률 측정(읽기 전용). 기획안 §4.1·§9 2주차.
 *
 *   npm run radar:v2:kiscon
 *   RADAR_KISCON_DAYS=1095 npm run radar:v2:kiscon   # 공시 조회 기간(기본 3년)
 *
 * API: apis.data.go.kr/1613000/ConAdminInfoSvc1/GongsiReg (data.go.kr 15061362 / 표준 15129444, 자동승인).
 * 키 = DATA_GO_KR_KISCON_KEY ?? DATA_GO_KR_BUILDING_KEY. 403 SERVICE_KEY_IS_NOT_REGISTERED = 활용신청 전.
 * ⚠ 승인 전이라 응답 필드는 문서 기준(ncrGsKname 업체명·ncrOffTel 전화·ncrGsAddr 소재지·ncrItemName 업종)으로만 작성 —
 *   첫 성공 실행에서 실제 키를 출력하니 필드명이 다르면 아래 FIELD 를 고칠 것.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { createClient } from "@supabase/supabase-js";
import { telValid } from "../lib/radar/nara-rules";

const BASE = "https://apis.data.go.kr/1613000/ConAdminInfoSvc1/GongsiReg";
const FIELD = { name: "ncrGsKname", tel: "ncrOffTel", addr: "ncrGsAddr", item: "ncrItemName" } as const;
const AREAS: Array<[string, string]> = [["경상북도", "경주시"], ["경상북도", "포항시"], ["울산광역시", ""]];
const normName = (s: string) => s.replace(/주식회사|\(주\)|㈜|유한회사|\(유\)|합자회사|\(합자\)|\(합\)|\s/g, "").toLowerCase();
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function call(params: Record<string, string>) {
  const key = process.env.DATA_GO_KR_KISCON_KEY || process.env.DATA_GO_KR_BUILDING_KEY;
  if (!key) throw new Error("DATA_GO_KR_KISCON_KEY / DATA_GO_KR_BUILDING_KEY 없음");
  const u = new URL(BASE);
  for (const [k, v] of Object.entries({ serviceKey: key, type: "json", ...params })) if (v) u.searchParams.set(k, v);
  const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const probe = await call({ pageNo: "1", numOfRows: "1", sDate: ymd(new Date(Date.now() - 30 * 86_400_000)), eDate: ymd(new Date()) });
  if (probe.status === 403 || /SERVICE_KEY_IS_NOT_REGISTERED/.test(probe.text)) {
    console.log("✗ 전국건설업체정보 API 미승인(SERVICE_KEY_IS_NOT_REGISTERED). data.go.kr 15061362(키스콘 건설업체정보) 활용신청 후 다시 실행하세요.");
    return;
  }
  if (probe.status !== 200) {
    console.log(`✗ HTTP ${probe.status}: ${probe.text.slice(0, 300)}`);
    process.exitCode = 1;
    return;
  }
  console.log("✓ API 응답 확인 — 첫 응답 일부:", probe.text.slice(0, 400));

  // 업체 명부(공시 기간 분할 조회 — 1년 단위)
  const days = Number(process.env.RADAR_KISCON_DAYS ?? 1095);
  // 상호 → 명부 항목들(동명 업체 구분용으로 모두 보관)
  const dir = new Map<string, Array<{ tel: string; addr: string; item: string }>>();
  let firstKeys: string[] | null = null;
  for (const [area, detail] of AREAS) {
    for (let off = 0; off < days; off += 365) {
      const end = new Date(Date.now() - off * 86_400_000);
      const bgn = new Date(end.getTime() - Math.min(365, days - off) * 86_400_000);
      for (let page = 1; page <= 200; page++) {
        const r = await call({ pageNo: String(page), numOfRows: "100", sDate: ymd(bgn), eDate: ymd(end), ncrAreaName: area, ncrAreaDetailName: detail });
        let items: Array<Record<string, string>> = [];
        try {
          const j = JSON.parse(r.text);
          const raw = j?.response?.body?.items?.item ?? j?.response?.body?.items ?? [];
          items = Array.isArray(raw) ? raw : raw ? [raw] : [];
        } catch {
          console.warn(`  ! JSON 아님(${area} ${detail} p${page}): ${r.text.slice(0, 120)}`);
          break;
        }
        if (!firstKeys && items[0]) { firstKeys = Object.keys(items[0]); console.log("  응답 필드:", firstKeys.join(", ")); }
        for (const it of items) {
          const name = String(it[FIELD.name] ?? "");
          if (!name) continue;
          const k = normName(name);
          const e = { tel: String(it[FIELD.tel] ?? ""), addr: String(it[FIELD.addr] ?? ""), item: String(it[FIELD.item] ?? "") };
          const list = dir.get(k) ?? [];
          if (!list.some((x) => x.tel === e.tel && x.addr === e.addr)) list.push(e);
          dir.set(k, list);
        }
        if (items.length < 100) break;
      }
    }
  }
  console.log(`  명부 ${dir.size}개 업체`);

  // 전화가 마스킹된 낙찰사(계정) → 명부에서 전화 찾기
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  type Row = { id: string; awardee_bizno: string | null; awarded_company: string | null; tel: string | null; addr: string | null };
  const rows: Row[] = [];
  for (let a = 0; ; a += 1000) {
    const { data, error } = await sb.from("construction_project")
      .select("id, awardee_bizno, awarded_company, tel:raw->>bidwinnrTelNo, addr:raw->>bidwinnrAdrs")
      .eq("source", "nara_bid").eq("stage", "awarded").is("deleted_at", null)
      .order("id").range(a, a + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const masked = new Map<string, { company: string; addr: string | null }>();
  for (const r of rows) {
    if (!telValid(r.tel) && r.awarded_company) masked.set(r.awardee_bizno ?? r.awarded_company, { company: r.awarded_company, addr: r.addr });
  }
  // 시군 = 주소 앞 두 토큰(예: "경상북도 경주시") — 동명 업체는 시군까지 같아야 같은 업체로 본다.
  const sigun = (a: string | null | undefined) => (a ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, 2).join(" ");
  let filled = 0;
  let ambiguous = 0;
  for (const [, { company, addr }] of masked) {
    const cands = (dir.get(normName(company)) ?? []).filter((x) => telValid(x.tel));
    const same = addr ? cands.filter((x) => sigun(x.addr) === sigun(addr)) : [];
    const pick = same.length === 1 ? same[0] : cands.length === 1 && !addr ? cands[0] : null;
    if (pick) {
      filled += 1;
      console.log(`  + ${company} → ${pick.tel} (${pick.item} · ${sigun(pick.addr)})`);
    } else if (cands.length > 0) {
      ambiguous += 1;
      console.log(`  ? ${company} — 명부 동명 ${cands.length}곳, 소재지(${sigun(addr) || "미상"})로 하나를 고르지 못함 — 채움에서 제외`);
    }
  }
  console.log(
    `\n채움률: 마스킹 계정 ${masked.size} 중 ${filled} (${masked.size ? Math.round((filled / masked.size) * 100) : 0}%) · 모호 ${ambiguous}` +
      ` — 기획안 기준 ≥70%면 마스킹 행을 전화 목록에 복귀. 출력 번호는 상호+시군 일치일 뿐이니 통화 전 업체 확인.`,
  );
}

main().catch((e) => { console.error("[kiscon] 실패:", e); process.exit(1); });
