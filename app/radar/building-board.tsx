"use client";

import { useMemo, useState } from "react";
import { HandshakeIcon, PhoneCallIcon, RecycleIcon, TruckIcon } from "lucide-react";
import { KpiCard } from "@/components/admin/kpi-card";
import {
  BOARD_COLUMNS,
  boardColumn,
  estimateDeliveryTier,
  DELIVERY_LABEL,
  USAGE_LABEL,
  RELEVANCE_GRADE_META,
  type RadarProjectRow,
  type BoardColumn,
  type SalesPlay,
} from "@/lib/radar/types";
import { cn } from "@/lib/utils";

const COL_DATE: Record<BoardColumn, keyof RadarProjectRow> = {
  permit: "permit_date",
  imminent: "sched_start_date",
  construction: "start_date",
  completed: "completion_date",
};
const COL_DATE_LABEL: Record<BoardColumn, string> = {
  permit: "허가",
  imminent: "착공예정",
  construction: "착공",
  completed: "준공",
};
const COL_ACTION: Record<BoardColumn, string> = {
  permit: "선점 · 시공사 파악",
  imminent: "견적 제안",
  construction: "지금 납품",
  completed: "남은 철근 매입",
};

const fmtDate = (iso: string | null) => (iso ? iso.replaceAll("-", ".").slice(2) : ""); // YY.MM.DD
function relLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const n = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  if (n > 0) return `D-${n}`;
  if (n === 0) return "오늘";
  return `${-n}일 전`;
}

const FRESH_DAYS = 90; // 3개월 — 착공 후 철근 납품 타이밍(이후는 이미 샀거나 준공 미반영 의심)
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((now.getTime() - d.getTime()) / 86_400_000);
}
const isFresh = (iso: string | null) => {
  const n = daysSince(iso);
  return n != null && n >= 0 && n <= FRESH_DAYS;
};

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2 };
/** 컬럼 정렬: 신선한 것(최근 날짜) 위로 → 그다음 등급 A·B·C → 같으면 날짜 최신순. */
function sortColumn(col: BoardColumn, rows: RadarProjectRow[]): RadarProjectRow[] {
  const key = COL_DATE[col];
  return rows.slice().sort((a, b) => {
    const fa = isFresh(a[key] as string | null) ? 0 : 1;
    const fb = isFresh(b[key] as string | null) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ga = GRADE_RANK[a.relevance_grade ?? "C"] ?? 2;
    const gb = GRADE_RANK[b.relevance_grade ?? "C"] ?? 2;
    if (ga !== gb) return ga - gb;
    return String(b[key] ?? "").localeCompare(String(a[key] ?? ""));
  });
}

function BuildingCard({ p, col }: { p: RadarProjectRow; col: BoardColumn }) {
  const grade = p.relevance_grade ? RELEVANCE_GRADE_META[p.relevance_grade] : null;
  const tier = estimateDeliveryTier(p.floor_area, p.usage);
  const dateVal = p[COL_DATE[col]] as string | null;
  const isBuy = col === "completed";
  const isNow = col === "construction";

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-xs ring-1 ring-foreground/5">
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 font-medium leading-tight">{p.title}</span>
        {grade ? (
          <span className={cn("shrink-0 rounded border px-1 text-[10px] font-semibold", grade.className)}>
            {grade.label}
          </span>
        ) : null}
      </div>
      {p.address ? <div className="line-clamp-1 text-muted-foreground">{p.address}</div> : null}

      <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        {p.usage ? <span>{USAGE_LABEL[p.usage] ?? p.usage}</span> : null}
        {p.floor_area ? <span>· {Math.round(p.floor_area).toLocaleString("ko-KR")}㎡</span> : null}
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded px-1",
            tier === "25t"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300",
          )}
        >
          <TruckIcon className="size-3" />
          {DELIVERY_LABEL[tier]}
        </span>
      </div>

      <div className="flex items-center justify-between tabular-nums">
        <span className="text-foreground">
          {COL_DATE_LABEL[col]} {fmtDate(dateVal)}
          {dateVal ? <span className="ml-1 text-muted-foreground">({relLabel(dateVal)})</span> : null}
        </span>
        {p.est_rebar_ton ? (
          <span className="text-muted-foreground">약 {Math.round(p.est_rebar_ton).toLocaleString("ko-KR")}톤</span>
        ) : null}
      </div>

      {isNow && dateVal ? (
        isFresh(dateVal) ? (
          <span className="self-start rounded bg-red-100 px-1 text-[10px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
            🔥 신선 · 지금 납품
          </span>
        ) : (
          <span className="self-start rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            ⚠ 장기 · 준공 미반영 의심
          </span>
        )
      ) : null}

      <div
        className={cn(
          "mt-0.5 flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium",
          isBuy
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : isNow
              ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
              : "bg-muted/60 text-foreground",
        )}
      >
        {isBuy ? (
          <RecycleIcon className="size-3" />
        ) : isNow ? (
          <PhoneCallIcon className="size-3" />
        ) : (
          <HandshakeIcon className="size-3" />
        )}
        {COL_ACTION[col]}
      </div>
    </div>
  );
}

export function BuildingBoard({ projects }: { projects: RadarProjectRow[] }) {
  const [play, setPlay] = useState<"all" | SalesPlay>("all");

  const byCol = useMemo(() => {
    const m: Record<BoardColumn, RadarProjectRow[]> = {
      permit: [],
      imminent: [],
      construction: [],
      completed: [],
    };
    for (const p of projects) m[boardColumn(p)].push(p);
    for (const k of Object.keys(m) as BoardColumn[]) m[k] = sortColumn(k, m[k]);
    return m;
  }, [projects]);

  const kpi = useMemo(() => {
    const big = projects.filter((p) => estimateDeliveryTier(p.floor_area, p.usage) === "25t").length;
    const ton = projects
      .filter((p) => boardColumn(p) !== "completed")
      .reduce((s, p) => s + (p.est_rebar_ton ?? 0), 0);
    const freshStart = byCol.construction.filter((p) => isFresh(p.start_date)).length;
    return {
      construction: byCol.construction.length,
      freshStart,
      completed: byCol.completed.length,
      big,
      ton,
    };
  }, [projects, byCol]);

  const cols = BOARD_COLUMNS.filter((c) => play === "all" || c.play === play);

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="착공·납품 (최근 3개월) 💰"
          value={`${kpi.freshStart}건`}
          hint={`진짜 납품 타이밍 · 착공 전체 ${kpi.construction}`}
        />
        <KpiCard title="준공·매입 대상 💰" value={`${kpi.completed}건`} hint="남은 철근 매입" />
        <KpiCard title="대형 현장 (25톤)" value={`${kpi.big}건`} hint="대량·반복 거래" />
        <KpiCard
          title="판매 잠재 철근"
          value={`약 ${Math.round(kpi.ton).toLocaleString("ko-KR")}톤`}
          hint="허가~시공 합계"
        />
      </section>

      <div className="flex gap-1.5">
        {(
          [
            ["all", "전체"],
            ["sell", "📤 판매"],
            ["buy", "📥 매입"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => setPlay(v)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              play === v
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {l}
          </button>
        ))}
      </div>

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
      >
        {cols.map((c) => (
          <div key={c.key} className={cn("flex flex-col gap-2 rounded-xl border p-2", c.className)}>
            <div className="flex items-center justify-between px-1">
              <div>
                <div className="text-sm font-semibold">{c.label}</div>
                <div className="text-[11px] text-muted-foreground">{c.sub}</div>
              </div>
              <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs font-medium tabular-nums">
                {byCol[c.key].length}
              </span>
            </div>
            <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto pr-0.5">
              {byCol[c.key].length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">없음</p>
              ) : (
                byCol[c.key].map((p) => <BuildingCard key={p.id} p={p} col={c.key} />)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
