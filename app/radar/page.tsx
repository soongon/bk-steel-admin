import { createClient } from "@/lib/supabase/server";
import type { RadarProjectRow } from "@/lib/radar/types";
import { RadarDashboard } from "./radar-dashboard";

/**
 * 발주 레이더 대시보드 (1차 — "보는 것").
 * construction_project 를 읽어 클라이언트에서 지역탭·필터·정렬. 준공(completed)은 기본 숨김.
 * 수집 전/마이그레이션 전이면 친절한 빈·오류 상태를 보여준다.
 */
export default async function RadarPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("construction_project")
    .select(
      "id, source, source_key, region, sigungu_code, project_type, title, address, lat, lng, distance_km, usage, structure, floor_area, est_rebar_ton, stage, stage_date, permit_date, sched_start_date, start_date, completion_date, ordering_org, contact_party, awarded_company, relevance_grade, relevance_score, est_amount, source_url, linked_partner_id, created_at, updated_at",
    )
    .is("deleted_at", null)
    .order("relevance_score", { ascending: false });

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">발주 레이더</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          경주·포항·울산 — 곧 철근·강관이 필요해질 건설 현장. 어디에 / 언제 / 누구한테 전화할지.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">데이터를 불러오지 못했습니다: {error.message}</p>
          <p className="mt-1 text-xs">
            테이블이 아직 없다면 마이그레이션 <code>0038_construction_project.sql</code> 적용이
            필요합니다. 데이터가 없으면 <code>npm run radar:collect</code>(키 필요) 또는 샘플 시드를
            넣어 보세요.
          </p>
        </div>
      ) : (
        <RadarDashboard projects={(data ?? []) as RadarProjectRow[]} />
      )}
    </div>
  );
}
