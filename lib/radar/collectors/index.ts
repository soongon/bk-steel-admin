/**
 * 수집 오케스트레이션 — 모든 어댑터 순회 → 정규화 → 점수 → upsert.
 *
 * 새 소스 추가: 어댑터 파일 하나(Collector 구현)를 만들고 COLLECTORS 배열에 push.
 * DB 접근은 주입된 service_role 클라이언트로만(여기선 env를 읽지 않음 — 진입 스크립트 책임).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollectedProject, UpsertableProject } from "../types";
import { computeRelevance, computeNaraRelevance, estimateRebarTon } from "../scoring";
import { buildingPermitCollector } from "./buildingPermit";
import { naraBidCollector } from "./naraBid";
import type { Collector, CollectContext } from "./types";

export type { Collector, CollectContext } from "./types";

/** 소스 레지스트리 — 확장 지점. */
export const COLLECTORS: Collector[] = [buildingPermitCollector, naraBidCollector];

/** 모든 어댑터 실행 → CollectedProject[] 합본. */
export async function runCollectors(ctx: CollectContext): Promise<CollectedProject[]> {
  const all: CollectedProject[] = [];
  for (const c of COLLECTORS) {
    if (ctx.sources && !ctx.sources.includes(c.source)) continue;
    const items = await c.collect(ctx);
    console.log(`[radar] ${c.label}: ${items.length}건`);
    all.push(...items);
  }
  return all;
}

/**
 * 점수·추정톤 부착. 거리(distance_km)는 지오코딩 전이라 null(scoreDistance가 중립 처리).
 * 지오코딩(phase 1.5) 도입 후엔 distanceKm를 넣어 재점수.
 */
export function scoreProjects(items: CollectedProject[]): UpsertableProject[] {
  return items.map((p) => {
    const rel =
      p.source === "nara_bid"
        ? computeNaraRelevance({ category: p.usage, estAmount: p.est_amount })
        : computeRelevance({
            usage: p.usage,
            structure: p.structure,
            floorArea: p.floor_area,
            distanceKm: null,
          });
    return {
      ...p,
      relevance_score: rel.score,
      relevance_grade: rel.grade,
      est_rebar_ton:
        p.source === "nara_bid" ? null : estimateRebarTon(p.floor_area, p.usage, p.structure),
      lat: null,
      lng: null,
      distance_km: null,
    };
  });
}

/**
 * construction_project upsert — (source, source_key) 충돌 시 갱신.
 * payload에 created_at을 안 넣으므로 최초 수집 시각은 보존, updated_at은 트리거가 갱신.
 */
export async function upsertProjects(
  supabase: SupabaseClient,
  rows: UpsertableProject[],
): Promise<{ upserted: number }> {
  if (rows.length === 0) return { upserted: 0 };
  // (source, source_key) 중복 제거 — 건축인허가 API는 무정렬 페이징이라 같은 레코드가
  // 여러 페이지에 중복 등장할 수 있다. 한 배치에 중복 키가 있으면 Postgres가
  // "ON CONFLICT DO UPDATE cannot affect row a second time" 에러를 내므로 사전 dedupe.
  const byKey = new Map<string, UpsertableProject>();
  for (const r of rows) byKey.set(`${r.source}::${r.source_key}`, r);
  const deduped = [...byKey.values()];

  const { error, count } = await supabase
    .from("construction_project")
    .upsert(deduped, { onConflict: "source,source_key", count: "exact" });
  if (error) throw new Error(`upsert 실패: ${error.message}`);
  return { upserted: count ?? deduped.length };
}

/** 전체 파이프라인: 수집 → 점수 → upsert. */
export async function runRadarCollection(
  supabase: SupabaseClient,
  ctx: CollectContext = { sinceDays: 30 },
): Promise<{ collected: number; upserted: number }> {
  const collected = await runCollectors(ctx);
  const scored = scoreProjects(collected);
  const { upserted } = await upsertProjects(supabase, scored);
  return { collected: collected.length, upserted };
}
