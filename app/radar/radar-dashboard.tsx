"use client";

import { useMemo, useState } from "react";
import { MapIcon } from "lucide-react";
import { KpiCard } from "@/components/admin/kpi-card";
import {
  RADAR_REGIONS,
  RADAR_REGION_LABEL,
  RADAR_STAGES,
  RADAR_STAGE_META,
  RELEVANCE_GRADES,
  RADAR_SOURCES,
  RADAR_SOURCE_LABEL,
  USAGE_LABEL,
  type RadarProjectRow,
  type RadarRegion,
  type RadarStage,
  type RadarSource,
  type RelevanceGrade,
} from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { ProjectCard } from "./project-card";

const URGENCY_RANK: Record<string, number> = { now: 0, watch: 1, done: 2 };
const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2 };

type RegionTab = "all" | RadarRegion;

/** 긴급도(착공·낙찰 먼저) → 등급 → 점수 순. A등급부터 치고 들어가게. */
function compareProjects(a: RadarProjectRow, b: RadarProjectRow): number {
  const ua = URGENCY_RANK[RADAR_STAGE_META[a.stage].urgency] ?? 1;
  const ub = URGENCY_RANK[RADAR_STAGE_META[b.stage].urgency] ?? 1;
  if (ua !== ub) return ua - ub;
  const ga = GRADE_RANK[a.relevance_grade ?? "C"] ?? 2;
  const gb = GRADE_RANK[b.relevance_grade ?? "C"] ?? 2;
  if (ga !== gb) return ga - gb;
  return (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
}

function computeKpis(rows: RadarProjectRow[]) {
  // 건축HUB는 발행 지연이 커 "이번주 실착공" 같은 지표가 무의미 → 실시간(관급 낙찰)·실용 지표로.
  const now = new Date();
  const ago = new Date(now);
  ago.setDate(now.getDate() - 7);
  const d7 = ago.toISOString().slice(0, 10); // 7일 전 (ISO date 문자열 비교)

  let recentAwards = 0; // 관급 낙찰 최근 7일 — 준실시간 "지금 전화" 리드
  let aCount = 0; // A등급 기회
  let ongoingStarts = 0; // 민간 진행 착공 현장
  let totalTon = 0; // 민간 추정 철근 합계
  for (const p of rows) {
    if (p.source === "nara_bid" && p.stage === "awarded" && p.stage_date && p.stage_date >= d7) {
      recentAwards += 1;
    }
    if (p.relevance_grade === "A") aCount += 1;
    if (p.source === "building_permit" && p.stage === "construction_start") ongoingStarts += 1;
    totalTon += p.est_rebar_ton ?? 0;
  }
  return { recentAwards, aCount, ongoingStarts, totalTon };
}

/** 토글 칩 하나. */
function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-foreground/20 bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** label + 칩 그룹. */
function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: "all" | T; label: string }[];
  value: "all" | T;
  onChange: (v: "all" | T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip key={o.value} active={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function RadarDashboard({ projects }: { projects: RadarProjectRow[] }) {
  const [region, setRegion] = useState<RegionTab>("all");
  const [stage, setStage] = useState<"all" | RadarStage>("all");
  const [grade, setGrade] = useState<"all" | RelevanceGrade>("all");
  const [usage, setUsage] = useState<"all" | string>("all");
  const [source, setSource] = useState<"all" | RadarSource>("all");

  // 지역 탭 = KPI 모집단
  const inRegion = useMemo(
    () => (region === "all" ? projects : projects.filter((p) => p.region === region)),
    [projects, region],
  );

  const kpis = useMemo(() => computeKpis(inRegion), [inRegion]);

  const usageOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of inRegion) if (p.usage) set.add(p.usage);
    return [...set];
  }, [inRegion]);

  const filtered = useMemo(
    () =>
      inRegion
        .filter((p) => stage === "all" || p.stage === stage)
        .filter((p) => grade === "all" || p.relevance_grade === grade)
        .filter((p) => usage === "all" || p.usage === usage)
        .filter((p) => source === "all" || p.source === source)
        .slice()
        .sort(compareProjects),
    [inRegion, stage, grade, usage, source],
  );

  const regionCounts = useMemo(() => {
    const m: Record<string, number> = { all: projects.length };
    for (const r of RADAR_REGIONS) m[r] = projects.filter((p) => p.region === r).length;
    return m;
  }, [projects]);

  return (
    <div className="flex flex-col gap-5">
      {/* 지역 탭 */}
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {(["all", ...RADAR_REGIONS] as RegionTab[]).map((r) => {
          const active = region === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {r === "all" ? "전체" : RADAR_REGION_LABEL[r]}
              <span className={cn("text-xs tabular-nums", active ? "opacity-80" : "opacity-60")}>
                {regionCounts[r] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* KPI 4개 */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="관급 낙찰 (7일)" value={`${kpis.recentAwards}건`} hint="지금 전화 · 낙찰사" />
        <KpiCard title="A등급 기회" value={`${kpis.aCount}건`} hint="관련성 상위" />
        <KpiCard title="진행 착공 현장" value={`${kpis.ongoingStarts}건`} hint="민간 · 진행 중" />
        <KpiCard
          title="추정 철근 합계"
          value={`약 ${Math.round(kpis.totalTon).toLocaleString("ko-KR")}톤`}
          hint="민간 연면적×계수"
        />
      </section>

      {/* 필터 바 */}
      <section className="flex flex-col gap-2.5 rounded-xl border bg-card/50 p-3">
        <FilterGroup
          label="단계"
          value={stage}
          onChange={setStage}
          options={[
            { value: "all", label: "전체" },
            ...RADAR_STAGES.filter((s) => s !== "completed").map((s) => ({
              value: s,
              label: RADAR_STAGE_META[s].label,
            })),
          ]}
        />
        <FilterGroup
          label="등급"
          value={grade}
          onChange={setGrade}
          options={[
            { value: "all", label: "전체" },
            ...RELEVANCE_GRADES.map((g) => ({ value: g, label: g })),
          ]}
        />
        {usageOptions.length > 0 ? (
          <FilterGroup
            label="용도"
            value={usage}
            onChange={setUsage}
            options={[
              { value: "all", label: "전체" },
              ...usageOptions.map((u) => ({ value: u, label: USAGE_LABEL[u] ?? u })),
            ]}
          />
        ) : null}
        <FilterGroup
          label="소스"
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: "전체" },
            ...RADAR_SOURCES.map((s) => ({ value: s, label: RADAR_SOURCE_LABEL[s] })),
          ]}
        />
      </section>

      {/* 지도 placeholder (phase 1.5) */}
      <section className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed bg-muted/30 text-center">
        <MapIcon className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">지도 — phase 1.5 (카카오맵 키 발급 후)</p>
        <p className="text-xs text-muted-foreground">
          권역 핀 · 등급별 색상 (A=코랄 · B=앰버 · C=그레이)
        </p>
      </section>

      {/* 카드 리스트 */}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <p className="text-sm font-medium">아직 수집된 발주가 없습니다.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <code>npm run radar:collect</code> (API 키 필요) 또는 샘플 시드
            <code> supabase/seed/0005_construction_sample.sql</code> 적용 후 표시됩니다.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          조건에 맞는 발주가 없습니다. 필터를 조정해 보세요.
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            관련성 높은 순 · <span className="font-medium text-foreground">{filtered.length}</span>건
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
