/**
 * 수집 오케스트레이션 — 모든 어댑터 순회 → 정규화 → 기존 행과 병합 → upsert.
 *
 * v2(기획안 §7 "index.ts 사전조회 병합"):
 *  - upsert 직전 배치의 (source, source_key)로 기존 raw·stage·stage_changed_at·region을 SELECT해
 *    raw = {...기존, ...신규}(공고 raw 보존), stage_changed_at = 단계가 바뀌면 now, 같으면 기존 값.
 *  - 신규 completed(기존 행 없음)는 skip — 준공은 기존 행의 단계 전환(리스트 이탈)만 의미가 있다.
 *  - payload는 UPSERT_COLUMNS 화이트리스트만. 사람 컬럼(dismissed_at·dismiss_reason·linked_partner_id)과
 *    지오코딩(lat·lng·distance_km)은 절대 덮지 않는다. 점수 컬럼은 null 기록(DROP 안 함).
 * DB 접근은 주입된 service_role 클라이언트로만(여기선 env를 읽지 않음 — 진입 스크립트 책임).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollectedProject, RadarRegion, RadarStage } from "../types";
import { buildingPermitCollector } from "./buildingPermit";
import { naraBidCollector } from "./naraBid";
import type { Collector, CollectContext, ExistingNaraRow } from "./types";

export type { Collector, CollectContext } from "./types";

/** 소스 레지스트리 — 확장 지점. (시청 고시 collector는 v2에서 제거.) */
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

// ── 병합(순수) ────────────────────────────────────────────────

/** upsert 페이로드 화이트리스트. 여기 없는 컬럼은 수집기가 절대 쓰지 않는다. */
export const UPSERT_COLUMNS = [
  "source", "source_key", "region", "sigungu_code", "project_type", "title", "address", "usage", "structure",
  "floor_area", "stage", "stage_date", "permit_date", "sched_start_date", "start_date", "completion_date",
  "ordering_org", "contact_party", "awarded_company", "est_amount", "source_url", "raw",
  "relevance_score", "relevance_grade", "est_rebar_ton", "stage_changed_at", "last_seen_at",
] as const;
/** 사람이 쓰는 컬럼 — 테스트가 UPSERT_COLUMNS와 교집합 0을 보장. */
export const HUMAN_COLUMNS = ["dismissed_at", "dismiss_reason", "linked_partner_id", "lat", "lng", "distance_km"] as const;

export interface ExistingRow {
  source: string;
  source_key: string;
  region: RadarRegion | null;
  stage: RadarStage | string;
  stage_changed_at: string | null;
  raw: unknown;
}

export interface UpsertRow extends CollectedProject {
  relevance_score: null;
  relevance_grade: null;
  est_rebar_ton: null;
  stage_changed_at: string;
  /** 이번 수집에서 소스가 이 행을 내려준 시각 — 화면 헤더 '동기화'(max) 기준. 수집기만 쓴다(0070). */
  last_seen_at: string;
}

export type MergeOutcome =
  | { kind: "skip_new_completed" }
  | { kind: "skip_regress" }
  | { kind: "insert" | "update" | "stage_change"; row: UpsertRow };

function mergeRaw(existing: unknown, incoming: unknown): unknown {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (isObj(existing) && isObj(incoming)) return { ...existing, ...incoming };
  return incoming ?? existing ?? null;
}

/** 수집 행 + 기존 행 → upsert 행. 부수효과 없음(테스트 대상). */
export function mergeWithExisting(p: CollectedProject, existing: ExistingRow | undefined, nowIso: string): MergeOutcome {
  if (!existing) {
    if (p.stage === "completed") return { kind: "skip_new_completed" };
    return {
      kind: "insert",
      row: { ...p, relevance_score: null, relevance_grade: null, est_rebar_ton: null, stage_changed_at: nowIso, last_seen_at: nowIso },
    };
  }
  // 낙찰→입찰공고 역행 금지 — 창 교차·낙찰 API 빈 응답으로 공고만 단독 도착해도 낙찰사·전화가 지워지지 않게.
  if (existing.stage === "awarded" && p.stage === "bid_notice") return { kind: "skip_regress" };
  const changed = existing.stage !== p.stage;
  return {
    kind: changed ? "stage_change" : "update",
    row: {
      ...p,
      region: existing.region ?? p.region, // 공고 현장지역으로 정한 권역을 낙찰 전환이 흔들지 않게
      raw: mergeRaw(existing.raw, p.raw),
      relevance_score: null,
      relevance_grade: null,
      est_rebar_ton: null,
      stage_changed_at: changed ? nowIso : (existing.stage_changed_at ?? nowIso),
      last_seen_at: nowIso,
    },
  };
}

/** 화이트리스트 컬럼만 담은 페이로드. */
export function toUpsertPayload(row: UpsertRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of UPSERT_COLUMNS) out[c] = (row as unknown as Record<string, unknown>)[c] ?? null;
  return out;
}

// ── DB ────────────────────────────────────────────────────────

export interface UpsertStats {
  upserted: number;
  inserted: number;
  updated: number;
  stageChanged: number;
  skippedCompleted: number;
  skippedRegress: number;
}

/** upsert POST 청크(본문이라 URL 제한 없음). */
const CHUNK = 500;
/** GET .in() 청크 — 건축 source_key ≈30자 × 150 ≈ 4.5KB(URL 길이 보호). */
const IN_CHUNK = 150;

/** (source, source_key) 묶음으로 기존 행 조회 — soft-delete 행도 포함(병합·단계 판정에 필요). */
async function fetchExisting(supabase: SupabaseClient, rows: CollectedProject[]): Promise<Map<string, ExistingRow>> {
  const map = new Map<string, ExistingRow>();
  const bySource = new Map<string, string[]>();
  for (const r of rows) {
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source)!.push(r.source_key);
  }
  for (const [source, keys] of bySource) {
    for (let i = 0; i < keys.length; i += IN_CHUNK) {
      const chunk = keys.slice(i, i + IN_CHUNK);
      const { data, error } = await supabase
        .from("construction_project")
        .select("source, source_key, region, stage, stage_changed_at, raw")
        .eq("source", source)
        .in("source_key", chunk);
      if (error) throw new Error(`기존 행 조회 실패: ${error.message}`);
      for (const r of (data ?? []) as ExistingRow[]) map.set(`${r.source}::${r.source_key}`, r);
    }
  }
  return map;
}

/**
 * construction_project upsert — (source, source_key) 충돌 시 갱신.
 * payload에 created_at·사람 컬럼을 안 넣으므로 최초 수집 시각·처분 상태는 보존, updated_at은 트리거가 갱신.
 */
export async function upsertProjects(supabase: SupabaseClient, rows: CollectedProject[]): Promise<UpsertStats> {
  const stats: UpsertStats = { upserted: 0, inserted: 0, updated: 0, stageChanged: 0, skippedCompleted: 0, skippedRegress: 0 };
  if (rows.length === 0) return stats;
  // (source, source_key) 중복 제거 — 건축인허가 API는 무정렬 페이징이라 같은 레코드가 여러 페이지에 중복 등장.
  const byKey = new Map<string, CollectedProject>();
  for (const r of rows) byKey.set(`${r.source}::${r.source_key}`, r);
  const deduped = [...byKey.values()];

  const existing = await fetchExisting(supabase, deduped);
  const nowIso = new Date().toISOString();
  const payloads: Record<string, unknown>[] = [];
  for (const p of deduped) {
    const m = mergeWithExisting(p, existing.get(`${p.source}::${p.source_key}`), nowIso);
    if (m.kind === "skip_new_completed") {
      stats.skippedCompleted += 1;
      continue;
    }
    if (m.kind === "skip_regress") {
      stats.skippedRegress += 1;
      continue;
    }
    if (m.kind === "insert") stats.inserted += 1;
    else if (m.kind === "stage_change") stats.stageChanged += 1;
    else stats.updated += 1;
    payloads.push(toUpsertPayload(m.row));
  }

  for (let i = 0; i < payloads.length; i += CHUNK) {
    const chunk = payloads.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from("construction_project")
      .upsert(chunk, { onConflict: "source,source_key", count: "exact" });
    if (error) throw new Error(`upsert 실패: ${error.message}`);
    stats.upserted += count ?? chunk.length;
  }
  return stats;
}

/** (관급) 공고번호 → DB 기존 행 조회기 — naraBid 의 낙찰 단독 경로에 주입(CollectContext.existingNaraByKey). */
export function existingNaraLookup(supabase: SupabaseClient) {
  return async (keys: string[]): Promise<Map<string, ExistingNaraRow>> => {
    const map = new Map<string, ExistingNaraRow>();
    for (let i = 0; i < keys.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("construction_project")
        .select("source_key, region, raw, deleted_at")
        .eq("source", "nara_bid")
        .in("source_key", keys.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as Array<{ source_key: string; region: RadarRegion | null; raw: Record<string, unknown> | null; deleted_at: string | null }>) {
        map.set(r.source_key, { region: r.region, raw: r.raw, deleted: !!r.deleted_at });
      }
    }
    return map;
  };
}

/** 전체 파이프라인: 수집 → 병합 → upsert. */
export async function runRadarCollection(
  supabase: SupabaseClient,
  ctx: CollectContext = { sinceDays: 30 },
): Promise<{ collected: number } & UpsertStats> {
  const collected = await runCollectors({ ...ctx, existingNaraByKey: ctx.existingNaraByKey ?? existingNaraLookup(supabase) });
  const stats = await upsertProjects(supabase, collected);
  return { collected: collected.length, ...stats };
}
