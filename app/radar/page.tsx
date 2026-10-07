import { createClient } from "@/lib/supabase/server";
import { kstToday, lastSeenBySource, loadVisitRows } from "@/lib/radar/radar-data";
import type { VisitViewRow } from "@/lib/radar/visit-view";
import { RadarV2 } from "./radar-v2";

/**
 * 발주 레이더 v2 — "오늘 할 일" 두 목록(방문 탭 · 전화 탭).
 * 1주차는 방문 탭(경주 민간 착공·허가)만. 전화 탭은 2주 콜 캠페인 판정 뒤(기획안 §9 D10).
 * 조회·규칙·상태 파생은 lib/radar/radar-data(loadVisitRows) — 알림·CSV·측정과 같은 함수.
 */
export default async function RadarPage() {
  const supabase = await createClient();
  const today = kstToday();

  let rows: VisitViewRow[] = [];
  let synced: { building: string | null; nara: string | null } = { building: null, nara: null };
  let error: string | null = null;
  try {
    [rows, synced] = await Promise.all([loadVisitRows(supabase, today), lastSeenBySource(supabase)]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">발주 레이더</h1>
        </header>
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">데이터를 불러오지 못했습니다: {error}</p>
          <p className="mt-1 text-xs">
            컬럼이 없다면 마이그레이션 <code>0069_radar_v2.sql</code>·<code>0070_radar_v2_fixes.sql</code> 적용이 필요합니다.
            데이터가 없으면 <code>npm run radar:collect</code>(키 필요)로 수집하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 md:p-6">
      <RadarV2 rows={rows} today={today} synced={synced} />
    </div>
  );
}
