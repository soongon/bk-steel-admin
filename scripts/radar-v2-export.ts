#!/usr/bin/env tsx
/**
 * 발주 레이더 v2 — D0 CSV 내보내기(화면 없이 바로 전화·방문). 읽기 전용. 화면과 같은 로더(lib/radar/radar-data).
 *
 *   npm run radar:v2:export            # ./radar-v2-전화목록-YYYYMMDD.csv, ./radar-v2-방문목록-YYYYMMDD.csv (gitignore)
 *   RADAR_EXPORT_DIR=/path npm run radar:v2:export
 *
 * 전화 목록 = 낙찰사 계정 — 라벨(★ 거래처 / RC)·낙찰사·대표·전화·소재지·사업자번호·최근 낙찰·낙찰 건수
 * 방문 목록 = 방문 탭 '오늘' 행 — 밴드·읍면동·단계·N일째·주소·제목 힌트·주용도·연면적·신축/증축·반영일·지도 링크
 * 기록: 전화는 영업내역 페이지(/all/sales-log) — 잠재 거래처명=낙찰사, 채널=전화, 결과=결과 코드 4종 문자열,
 *   메모 첫 줄에 마지막 열 값("레이더 {id}") 그대로 붙여넣기 → 수집 cron 이 매일 project_id 로 연결하고
 *   '거절'·'현장 없음'이면 계정을 제외(다음 CSV 에서 빠짐). 방문은 화면(/radar)의 [방문 기록]으로만.
 * 통화 첫 문장: "나라장터 낙찰 정보(공공데이터)를 보고 연락드린 경주 ○○철강입니다" (기획안 §6).
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { toCsv } from "../lib/radar/csv";
import { formatBusinessNo, formatPhone } from "../lib/format";
import { findUnmappedRadarNotes, kstToday, loadPhoneAccounts, loadVisitRows } from "../lib/radar/radar-data";
import { BAND_LABEL, daysSince } from "../lib/radar/v2-rules";

const eok = (n: number | null) => (n == null ? "" : (n / 1e8).toFixed(1) + "억");

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요(.env.local)");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const today = kstToday();
  const dir = process.env.RADAR_EXPORT_DIR ?? process.cwd();
  const ymd = today.replace(/-/g, "");

  // ── 콜 직전 경고: 계정에 연결할 수 없는 '레이더' 메모(이 기록의 거절은 목록에 반영되지 않음) ──
  const unmapped = await findUnmappedRadarNotes(sb);
  if (unmapped.length > 0) {
    console.warn(`⚠ 연결할 수 없는 '레이더' 메모 ${unmapped.length}건 — 메모의 "레이더 {id}"를 CSV 마지막 열 값으로 고치세요:`);
    for (const u of unmapped) console.warn(`   ${u.contacted_on} ${u.prospect_name ?? "-"} | 결과 ${u.result ?? "-"} | ${u.reason} (sales_log ${u.log_id})`);
  }

  // ── 전화 목록 ──
  const phone = await loadPhoneAccounts(sb, today);
  const phoneRows: unknown[][] = [[
    "라벨", "낙찰사", "대표", "전화", "소재지", "사업자번호", "최근 낙찰일", "N일 전", "낙찰금액", "공사명", "발주처", "규칙 낙찰 건수", "기존 거래처",
    "마지막 접촉일", "마지막 결과", "메모용(그대로 붙여넣기)",
  ]];
  for (const a of phone.accounts) {
    const w = a.awards[0];
    const label = [a.partnerName ? "★거래처" : "", a.awards.some((x) => x.rc) ? "RC" : ""].filter(Boolean).join(" ");
    phoneRows.push([
      label, a.company, a.ceo, formatPhone(a.tel), a.addr, formatBusinessNo(a.bizno), w?.stage_date, daysSince(w?.stage_date, today),
      eok(w?.est_amount ?? null), w?.title, w?.ordering_org, a.awards.length, a.partnerName ?? "",
      a.lastTouch?.contacted_on ?? "", a.lastTouch?.result ?? "", w ? `레이더 ${w.id}` : "",
    ]);
  }
  const phonePath = join(dir, `radar-v2-전화목록-${ymd}.csv`);
  writeFileSync(phonePath, toCsv(phoneRows));
  console.log(`전화 목록 ${phoneRows.length - 1}계정 → ${phonePath} (창 안 마스킹 제외 ${phone.maskedInWindow})`);

  // ── 방문 목록(오늘) ──
  const visits = (await loadVisitRows(sb, today)).filter((r) => r.status === "today");
  const visitRows: unknown[][] = [["밴드", "읍면동", "단계", "N일째", "주소", "제목(힌트)", "주용도", "연면적㎡", "신축/증축", "반영일", "지도 검색", "레이더 id"]];
  for (const r of visits) {
    visitRows.push([
      BAND_LABEL[r.band], r.emd ?? "", r.stage === "construction_start" ? "착공" : "허가(착공 전)", r.days ?? "", r.address, r.titleHint ?? "",
      r.mainPurps ?? "", r.floorArea == null ? "" : Math.round(r.floorArea), r.archGb ?? "",
      r.stageChangedAt ? kstToday(new Date(r.stageChangedAt)) : "", r.mapUrl, `레이더 ${r.id}`,
    ]);
  }
  const visitPath = join(dir, `radar-v2-방문목록-${ymd}.csv`);
  writeFileSync(visitPath, toCsv(visitRows));
  console.log(`방문 목록 ${visitRows.length - 1}행 → ${visitPath}`);
}

main().catch((e) => { console.error("[export] 실패:", e); process.exit(1); });
