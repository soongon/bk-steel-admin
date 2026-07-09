"use client";

import { useMemo, useState } from "react";
import {
  HardHatIcon,
  LandmarkIcon,
  PhoneCallIcon,
  RecycleIcon,
  TruckIcon,
  Building2Icon,
} from "lucide-react";
import { KpiCard } from "@/components/admin/kpi-card";
import {
  RADAR_REGIONS,
  RADAR_REGION_LABEL,
  RELEVANCE_GRADE_META,
  USAGE_LABEL,
  estimateDeliveryTier,
  DELIVERY_LABEL,
  salesMode,
  type RadarProjectRow,
  type RadarRegion,
  type SalesPlay,
} from "@/lib/radar/types";
import { cn } from "@/lib/utils";
import { BuildingBoard } from "./building-board";
import { ProjectCard } from "./project-card";

type RegionTab = "all" | RadarRegion;
type SourceTab = "building" | "nara" | "notice";

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2 };
const fmtKrw = (n: number | null) =>
  n == null ? "" : n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString("ko-KR")}만`;
const byDateDesc = (key: keyof RadarProjectRow) => (a: RadarProjectRow, b: RadarProjectRow) =>
  String(b[key] ?? "").localeCompare(String(a[key] ?? ""));

/** 관급(나라장터) 뷰 — 낙찰 우선 리스트 + 관급 KPI. (판매: 신축·구조토목) */
function NaraView({ projects }: { projects: RadarProjectRow[] }) {
  const now = new Date();
  const ago = new Date(now);
  ago.setDate(now.getDate() - 7);
  const d7 = ago.toISOString().slice(0, 10);

  const awarded7 = projects.filter((p) => p.stage === "awarded" && p.stage_date && p.stage_date >= d7).length;
  const aCount = projects.filter((p) => p.relevance_grade === "A").length;
  const notices = projects.filter((p) => p.stage === "bid_notice").length;

  // 낙찰 확정: 낙찰일 역순(최신=지금 전화). 입찰공고: 등급→점수(선점 우선).
  const byGradeScore = (a: RadarProjectRow, b: RadarProjectRow) => {
    const ga = GRADE_RANK[a.relevance_grade ?? "C"] ?? 2;
    const gb = GRADE_RANK[b.relevance_grade ?? "C"] ?? 2;
    if (ga !== gb) return ga - gb;
    return (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
  };
  const awardedList = useMemo(
    () =>
      projects
        .filter((p) => p.stage === "awarded")
        .sort((a, b) => (b.stage_date ?? "").localeCompare(a.stage_date ?? "") || byGradeScore(a, b)),
    [projects],
  );
  const noticeList = useMemo(
    () => projects.filter((p) => p.stage === "bid_notice").sort(byGradeScore),
    [projects],
  );
  // 그 외 단계(있으면) — 안전망.
  const otherList = useMemo(
    () => projects.filter((p) => p.stage !== "awarded" && p.stage !== "bid_notice").sort(byGradeScore),
    [projects],
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard title="낙찰 (최근 7일) 💰" value={`${awarded7}건`} hint="지금 전화 — 낙찰사" />
        <KpiCard title="A등급 기회" value={`${aCount}건`} hint="철근 관련성 상위" />
        <KpiCard title="입찰공고 (대기)" value={`${notices}건`} hint="낙찰 전 모니터링" />
      </section>
      {projects.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          이 권역의 관급 발주가 없습니다.
        </p>
      ) : (
        <>
          {awardedList.length > 0 ? (
            <ProjectSection title="🔵 낙찰 확정" hint="낙찰사에 전화 · 최신순" projects={awardedList} />
          ) : null}
          {noticeList.length > 0 ? (
            <ProjectSection title="⏳ 입찰공고 (대기)" hint="낙찰 전 모니터링" projects={noticeList} />
          ) : null}
          {otherList.length > 0 ? <ProjectSection title="기타" projects={otherList} /> : null}
        </>
      )}
    </div>
  );
}

/** 관급 뷰 섹션 — 제목 + 건수 + 카드 그리드. */
function ProjectSection({
  title,
  hint,
  projects,
}: {
  title: string;
  hint?: string;
  projects: RadarProjectRow[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">
          {title} <span className="text-muted-foreground">{projects.length}</span>
        </h3>
        {hint ? <span className="text-xs text-muted-foreground">· {hint}</span> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => (
          <ProjectCard key={p.id} p={p} />
        ))}
      </div>
    </section>
  );
}

/** 시청 고시(선점) 뷰 — 게시일 강조 리스트. 화면은 추후 정교화. */
function NoticeView({ projects }: { projects: RadarProjectRow[] }) {
  const sorted = useMemo(() => [...projects].sort(byDateDesc("stage_date")), [projects]);
  const industrial = projects.filter((p) => p.usage === "industrial_complex").length;
  const aCount = projects.filter((p) => p.relevance_grade === "A").length;

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard title="산업·물류단지 🏭" value={`${industrial}건`} hint="대형 철근 선행" />
        <KpiCard title="A등급 선점" value={`${aCount}건`} hint="산단·정비·대형건축" />
        <KpiCard title="고시 전체" value={`${projects.length}건`} hint="최근 게시" />
      </section>
      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          이 권역의 고시(선점) 리드가 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((p) => {
            const grade = p.relevance_grade ? RELEVANCE_GRADE_META[p.relevance_grade] : null;
            const cat = p.usage ? (USAGE_LABEL[p.usage] ?? p.usage) : "";
            return (
              <div
                key={p.id}
                className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-sm ring-1 ring-foreground/5"
              >
                <span className="w-16 shrink-0 tabular-nums text-xs text-muted-foreground">
                  {p.stage_date ? p.stage_date.slice(2).replaceAll("-", ".") : ""}
                </span>
                {grade ? (
                  <span className={cn("shrink-0 rounded border px-1 text-[10px] font-semibold", grade.className)}>
                    {grade.label}
                  </span>
                ) : null}
                {cat ? (
                  <span className="shrink-0 rounded bg-indigo-100 px-1.5 text-[11px] text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                    {cat}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">
                  {p.source_url ? (
                    <a href={p.source_url} target="_blank" rel="noreferrer" className="hover:underline" title={p.title}>
                      {p.title}
                    </a>
                  ) : (
                    p.title
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{RADAR_REGION_LABEL[p.region]}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 매입(buy) 뷰 — 나라장터 철거·해체(낙찰사=철거업체) + 민간 준공(남은 철근). */
function BuyView({ projects }: { projects: RadarProjectRow[] }) {
  const demo = useMemo(
    () => projects.filter((p) => p.usage === "demolition").sort(byDateDesc("stage_date")),
    [projects],
  );
  const done = useMemo(
    () =>
      projects
        .filter((p) => p.source === "building_permit" && p.stage === "completed")
        .sort(byDateDesc("completion_date")),
    [projects],
  );
  const aCount = projects.filter((p) => p.relevance_grade === "A").length;

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard title="철거·해체 ♻️" value={`${demo.length}건`} hint="고철·중고철근 — 철거업체 전화" />
        <KpiCard title="준공 정리" value={`${done.length}건`} hint="남은 철근 매입" />
        <KpiCard title="A등급 매입" value={`${aCount}건`} hint="물량 상위" />
      </section>

      {/* 나라장터 철거·해체 */}
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <RecycleIcon className="size-4 text-emerald-600" /> 나라장터 철거·해체
          <span className="text-xs font-normal text-muted-foreground">낙찰사(철거업체) = 매입처</span>
        </h3>
        {demo.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 p-5 text-center text-xs text-muted-foreground">
            이 권역의 철거·해체 발주가 없습니다.
          </p>
        ) : (
          demo.map((p) => {
            const grade = p.relevance_grade ? RELEVANCE_GRADE_META[p.relevance_grade] : null;
            return (
              <div
                key={p.id}
                className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-sm ring-1 ring-emerald-500/10"
              >
                <span className="w-14 shrink-0 tabular-nums text-xs text-muted-foreground">
                  {p.stage_date ? p.stage_date.slice(2).replaceAll("-", ".") : ""}
                </span>
                {grade ? (
                  <span className={cn("shrink-0 rounded border px-1 text-[10px] font-semibold", grade.className)}>
                    {grade.label}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate" title={p.title}>
                  {p.title}
                </span>
                {p.est_amount ? (
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{fmtKrw(p.est_amount)}</span>
                ) : null}
                {p.contact_party && p.stage === "awarded" ? (
                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {p.contact_party}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted-foreground">낙찰 전</span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">{RADAR_REGION_LABEL[p.region]}</span>
              </div>
            );
          })
        )}
      </div>

      {/* 민간 준공 — 남은 철근 */}
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Building2Icon className="size-4 text-muted-foreground" /> 민간 준공 현장
          <span className="text-xs font-normal text-muted-foreground">남은 철근 정리</span>
        </h3>
        {done.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 p-5 text-center text-xs text-muted-foreground">
            이 권역의 준공 현장이 없습니다.
          </p>
        ) : (
          done.map((p) => {
            const grade = p.relevance_grade ? RELEVANCE_GRADE_META[p.relevance_grade] : null;
            const tier = estimateDeliveryTier(p.floor_area, p.usage);
            return (
              <div
                key={p.id}
                className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-sm ring-1 ring-foreground/5"
              >
                <span className="w-14 shrink-0 tabular-nums text-xs text-muted-foreground">
                  {p.completion_date ? p.completion_date.slice(2).replaceAll("-", ".") : ""}
                </span>
                {grade ? (
                  <span className={cn("shrink-0 rounded border px-1 text-[10px] font-semibold", grade.className)}>
                    {grade.label}
                  </span>
                ) : null}
                {p.usage ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">
                    {USAGE_LABEL[p.usage] ?? p.usage}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate" title={p.title}>
                  {p.title}
                </span>
                {p.floor_area ? (
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {Math.round(p.floor_area).toLocaleString("ko-KR")}㎡
                  </span>
                ) : null}
                <span className="shrink-0 inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                  <TruckIcon className="size-3" />
                  {DELIVERY_LABEL[tier]}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{RADAR_REGION_LABEL[p.region]}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SourceTabBtn({
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
  const [mode, setMode] = useState<SalesPlay>("sell");
  const [source, setSource] = useState<SourceTab>("building");

  const inRegion = useMemo(
    () => (region === "all" ? projects : projects.filter((p) => p.region === region)),
    [projects, region],
  );
  const inMode = useMemo(() => inRegion.filter((p) => salesMode(p) === mode), [inRegion, mode]);

  // 판매 모드 소스 분류 (salesMode가 sell이라 준공·철거는 이미 빠짐)
  const building = useMemo(() => inMode.filter((p) => p.source === "building_permit"), [inMode]);
  const nara = useMemo(() => inMode.filter((p) => p.source === "nara_bid"), [inMode]);
  const notice = useMemo(() => inMode.filter((p) => p.source === "notice"), [inMode]);

  const regionCounts = useMemo(() => {
    const m: Record<string, number> = { all: projects.length };
    for (const r of RADAR_REGIONS) m[r] = projects.filter((p) => p.region === r).length;
    return m;
  }, [projects]);
  const modeCounts = useMemo(() => {
    let sell = 0;
    let buy = 0;
    for (const p of inRegion) {
      if (salesMode(p) === "buy") buy += 1;
      else sell += 1;
    }
    return { sell, buy };
  }, [inRegion]);

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

      {/* 판매 / 매입 모드 — 영업 행동이 정반대라 최상위에서 분리 */}
      <div className="flex gap-2">
        {(
          [
            ["sell", "📤 판매 레이더", "곧 철근 필요한 현장", modeCounts.sell],
            ["buy", "📥 매입 레이더", "고철·중고·남은 철근", modeCounts.buy],
          ] as const
        ).map(([v, label, sub, count]) => (
          <button
            key={v}
            type="button"
            onClick={() => setMode(v)}
            className={cn(
              "flex flex-1 flex-col items-start rounded-xl border p-3 text-left transition-colors",
              mode === v
                ? v === "buy"
                  ? "border-emerald-500/40 bg-emerald-50/60 ring-1 ring-emerald-500/20 dark:bg-emerald-950/30"
                  : "border-foreground/30 bg-card ring-1 ring-foreground/10"
                : "border-border bg-card/40 hover:bg-card",
            )}
          >
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              {label}
              <span className="tabular-nums text-xs text-muted-foreground">{count}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </button>
        ))}
      </div>

      {mode === "sell" ? (
        <>
          {/* 판매 소스 탭 — 민간/관급/고시는 접근법이 달라 분리 */}
          <div className="flex gap-2">
            <SourceTabBtn
              active={source === "building"}
              onClick={() => setSource("building")}
              icon={HardHatIcon}
              label="민간 건축"
              sub="허가 → 착공임박 → 착공(납품)"
              count={building.length}
            />
            <SourceTabBtn
              active={source === "nara"}
              onClick={() => setSource("nara")}
              icon={PhoneCallIcon}
              label="관급 나라장터"
              sub="낙찰 → 지금 전화"
              count={nara.length}
            />
            <SourceTabBtn
              active={source === "notice"}
              onClick={() => setSource("notice")}
              icon={LandmarkIcon}
              label="시청 고시(선점)"
              sub="산단·정비 → 대형 선점"
              count={notice.length}
            />
          </div>

          {source === "building" ? (
            <BuildingBoard projects={building} />
          ) : source === "nara" ? (
            <NaraView projects={nara} />
          ) : (
            <NoticeView projects={notice} />
          )}
        </>
      ) : (
        <BuyView projects={inMode} />
      )}
    </div>
  );
}
