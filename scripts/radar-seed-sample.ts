#!/usr/bin/env tsx
/**
 * 샘플 데이터를 remote construction_project 에 upsert (UI 미리보기용).
 * supabase/seed/0005_construction_sample.sql 과 동일 데이터 — remote는 psql 없이 못 넣어 service_role 사용.
 * 실행: npx tsx scripts/radar-seed-sample.ts
 * 삭제: source_key LIKE '%-SAMPLE-%' 행 제거.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const d = (daysAgo: number) => {
  const t = new Date();
  t.setDate(t.getDate() - daysAgo);
  return t.toISOString().slice(0, 10);
};

const rows = [
  { source: "building_permit", source_key: "BP-SAMPLE-001", region: "gyeongju", sigungu_code: "47130", project_type: "private", title: "경주 외동 OO산업 공장 신축", address: "경북 경주시 외동읍 모화리 100-1", usage: "factory", structure: "steel", floor_area: 4200, est_rebar_ton: 189, stage: "construction_start", stage_date: d(1), ordering_org: null, contact_party: "건축주/시공사", awarded_company: null, relevance_grade: "A", relevance_score: 92.0, est_amount: null, raw: { sample: true } },
  { source: "building_permit", source_key: "BP-SAMPLE-002", region: "pohang", sigungu_code: "47113", project_type: "private", title: "포항 흥해 물류창고 신축", address: "경북 포항시 북구 흥해읍 매산리 55", usage: "warehouse", structure: "RC", floor_area: 3000, est_rebar_ton: 150, stage: "permit", stage_date: d(5), ordering_org: null, contact_party: "건축주/시공사", awarded_company: null, relevance_grade: "B", relevance_score: 58.0, est_amount: null, raw: { sample: true } },
  { source: "building_permit", source_key: "BP-SAMPLE-003", region: "ulsan", sigungu_code: "31140", project_type: "private", title: "울산 무거동 근린생활시설 신축", address: "울산 남구 무거동 770", usage: "neighborhood", structure: "RC", floor_area: 1800, est_rebar_ton: 126, stage: "construction_start", stage_date: d(2), ordering_org: null, contact_party: "건축주/시공사", awarded_company: null, relevance_grade: "B", relevance_score: 64.0, est_amount: null, raw: { sample: true } },
  { source: "building_permit", source_key: "BP-SAMPLE-004", region: "gyeongju", sigungu_code: "47130", project_type: "private", title: "경주 용강동 다가구주택 신축", address: "경북 경주시 용강동 1234", usage: "multi_family", structure: "RC", floor_area: 900, est_rebar_ton: 68, stage: "permit", stage_date: d(4), ordering_org: null, contact_party: "건축주/시공사", awarded_company: null, relevance_grade: "C", relevance_score: 44.0, est_amount: null, raw: { sample: true } },
  { source: "building_permit", source_key: "BP-SAMPLE-005", region: "ulsan", sigungu_code: "31200", project_type: "private", title: "울산 송정 공동주택 신축", address: "울산 북구 송정동 200", usage: "apartment", structure: "RC", floor_area: 12000, est_rebar_ton: 1020, stage: "permit", stage_date: d(6), ordering_org: null, contact_party: "건축주/시공사", awarded_company: null, relevance_grade: "C", relevance_score: 20.0, est_amount: null, raw: { sample: true } },
  { source: "nara_bid", source_key: "NB-SAMPLE-101", region: "pohang", sigungu_code: null, project_type: "public", title: "포항시 OO로 도로개설공사", address: "경상북도 포항시", usage: null, structure: null, floor_area: null, est_rebar_ton: null, stage: "awarded", stage_date: d(3), ordering_org: "포항시청", contact_party: "대성건설(주)", awarded_company: "대성건설(주)", relevance_grade: "C", relevance_score: 28.5, est_amount: 1850000000, raw: { sample: true } },
  { source: "nara_bid", source_key: "NB-SAMPLE-102", region: "ulsan", sigungu_code: null, project_type: "public", title: "울산 OO천 정비공사", address: "울산광역시", usage: null, structure: null, floor_area: null, est_rebar_ton: null, stage: "bid_notice", stage_date: d(2), ordering_org: "울산광역시청", contact_party: "낙찰 전 — 연락 대상 미정", awarded_company: null, relevance_grade: "C", relevance_score: 28.5, est_amount: 2300000000, raw: { sample: true } },
  { source: "nara_bid", source_key: "NB-SAMPLE-103", region: "gyeongju", sigungu_code: null, project_type: "public", title: "경주 OO일반산업단지 진입도로 공사", address: "경상북도 경주시", usage: null, structure: null, floor_area: null, est_rebar_ton: null, stage: "awarded", stage_date: d(1), ordering_org: "경주시청", contact_party: "신라토건(주)", awarded_company: "신라토건(주)", relevance_grade: "C", relevance_score: 28.5, est_amount: 4200000000, raw: { sample: true } },
];

(async () => {
  const { error, count } = await supabase
    .from("construction_project")
    .upsert(rows, { onConflict: "source,source_key", count: "exact" });
  if (error) {
    console.error("✗ upsert 실패:", error.message);
    process.exit(1);
  }
  console.log(`✓ 샘플 upsert 완료: ${count ?? rows.length}건`);

  const { count: total } = await supabase
    .from("construction_project")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null);
  console.log(`construction_project 총 행수(미삭제): ${total}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
