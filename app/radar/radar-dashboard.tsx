"use client";

import { useMemo, useState } from "react";
import { HardHatIcon, PhoneCallIcon } from "lucide-react";
import { KpiCard } from "@/components/admin/kpi-card";
import {
  RADAR_REGIONS,
  RADAR_REGION_LABEL,
  type RadarProjectRow,
  type RadarRegion,
} from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { BuildingBoard } from "./building-board";
import { ProjectCard } from "./project-card";

type RegionTab = "all" | RadarRegion;
type SourceTab = "building" | "nara";

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2 };

/** 관급(나라장터) 뷰 — 낙찰 우선 리스트 + 관급 KPI. */
function NaraView({ projects }: { projects: RadarProjectRow[] }) {
  const now = new Date();
  const ago = new Date(now);
  ago.setDate(now.getDate() - 7);
  const d7 = ago.toISOString().slice(0, 10);

  const awarded7 = projects.filter((p) => p.stage === "awarded" && p.stage_date && p.stage_date >= d7).length;
  const aCount = projects.filter((p) => p.relevance_grade === "A").length;
  const notices = projects.filter((p) => p.stage === "bid_notice").length;

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const ua = a.stage === "awarded" ? 0 : 1;
        const ub = b.stage === "awarded" ? 0 : 1;
        if (ua !== ub) return ua - ub;
        const ga = GRADE_RANK[a.relevance_grade ?? "C"] ?? 2;
        const gb = GRADE_RANK[b.relevance_grade ?? "C"] ?? 2;
        if (ga !== gb) return ga - gb;
        return (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
      }),
    [projects],
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard title="낙찰 (최근 7일) 💰" value={`${awarded7}건`} hint="지금 전화 — 낙찰사" />
        <KpiCard title="A등급 기회" value={`${aCount}건`} hint="철근 관련성 상위" />
        <KpiCard title="입찰공고 (대기)" value={`${notices}건`} hint="낙찰 전 모니터링" />
      </section>
      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          이 권역의 관급 발주가 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceTab({
  active,
  onClick,
  icon: Icon,
  label,
  sub,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center gap-2.5 rounded-xl border p-3 text-left transition-colors",
        active ? "border-foreground/30 bg-card ring-1 ring-foreground/10" : "border-border bg-card/40 hover:bg-card",
      )}
    >
      <Icon className={cn("size-5", active ? "text-foreground" : "text-muted-foreground")} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {label}
          <span className="tabular-nums text-xs text-muted-foreground">{count}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </button>
  );
}

export function RadarDashboard({ projects }: { projects: RadarProjectRow[] }) {
  const [region, setRegion] = useState<RegionTab>("all");
  const [source, setSource] = useState<SourceTab>("building");

  const inRegion = useMemo(
    () => (region === "all" ? projects : projects.filter((p) => p.region === region)),
    [projects, region],
  );
  const building = useMemo(() => inRegion.filter((p) => p.source === "building_permit"), [inRegion]);
  const nara = useMemo(() => inRegion.filter((p) => p.source === "nara_bid"), [inRegion]);

  const regionCounts = useMemo(() => {
    const m: Record<string, number> = { all: projects.length };
    for (const r of RADAR_REGIONS) m[r] = projects.filter((p) => p.region === r).length;
    return m;
  }, [projects]);

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center">
        <p className="text-sm font-medium">아직 수집된 발주가 없습니다.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          <code>npm run radar:collect</code> 실행 후 표시됩니다.
        </p>
      </div>
    );
  }

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

      {/* 소스 탭 — 민간/관급은 영업 접근법이 달라 분리 */}
      <div className="flex gap-2">
        <SourceTab
          active={source === "building"}
          onClick={() => setSource("building")}
          icon={HardHatIcon}
          label="민간 건축"
          sub="라이프사이클: 허가→착공→준공(매입)"
          count={building.length}
        />
        <SourceTab
          active={source === "nara"}
          onClick={() => setSource("nara")}
          icon={PhoneCallIcon}
          label="관급 나라장터"
          sub="낙찰 → 지금 전화"
          count={nara.length}
        />
      </div>

      {source === "building" ? <BuildingBoard projects={building} /> : <NaraView projects={nara} />}
    </div>
  );
}
