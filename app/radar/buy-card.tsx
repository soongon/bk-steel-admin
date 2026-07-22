"use client";

import { MapPinIcon, RecycleIcon, PhoneCallIcon, TruckIcon, RulerIcon } from "lucide-react";
import {
  RADAR_STAGE_META,
  RELEVANCE_GRADE_META,
  RADAR_REGION_LABEL,
  USAGE_LABEL,
  estimateDeliveryTier,
  DELIVERY_LABEL,
  type RadarProjectRow,
} from "@/lib/radar/types";
import { cn } from "@/lib/utils";

const fmtKrw = (n: number | null) =>
  n == null ? null : n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString("ko-KR")}만`;
const areaText = (a: number | null) => (a == null ? null : `${Math.round(a).toLocaleString("ko-KR")}㎡`);

/**
 * 매입 레이더 카드 — 판매 ProjectCard의 매입 버전(에메랄드로 색 분리).
 *  - 철거·해체(나라장터): 낙찰사(철거업체)=매입처. 낙찰 확정 시 초록 띠로 "철거업체 전화" 강조,
 *    낙찰 전이면 발주처만 표시(연락 대상 아님).
 *  - 민간 준공: 남은 철근 매입 대상 — 건축주/시공사 + 배송 추정.
 */
export function BuyCard({ p }: { p: RadarProjectRow }) {
  const isDemo = p.usage === "demolition";
  const stage = RADAR_STAGE_META[p.stage];
  const grade = p.relevance_grade ? RELEVANCE_GRADE_META[p.relevance_grade] : null;
  const isAwarded = p.stage === "awarded";
  const dateStr = isDemo ? p.stage_date : p.completion_date;
  const tier = estimateDeliveryTier(p.floor_area, p.usage);

  const meta = [
    p.usage ? (USAGE_LABEL[p.usage] ?? p.usage) : null,
    isDemo ? (p.est_amount ? fmtKrw(p.est_amount) : null) : areaText(p.floor_area),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 ring-1 ring-emerald-500/10">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-md border px-1.5 text-xs",
                isDemo
                  ? "border-emerald-500/40 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "border-zinc-400/40 bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300",
              )}
            >
              {isDemo ? "철거·해체" : "민간 준공"}
            </span>
            {grade ? (
              <span
                className={cn(
                  "inline-flex h-5 items-center rounded-md border px-2 text-xs font-bold",
                  grade.className,
                  // A등급(물량 상위)은 링으로 추가 강조.
                  p.relevance_grade === "A" && "ring-1 ring-rose-400/70",
                )}
              >
                {grade.label}등급
              </span>
            ) : null}
          </div>
          <h3 className="mt-1 truncate font-medium" title={p.title}>
            {p.title}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPinIcon className="size-3 shrink-0" />
            <span className="truncate">{p.address ?? "주소 미상"}</span>
            <span className="shrink-0">· {RADAR_REGION_LABEL[p.region]}</span>
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium",
            stage.className,
          )}
        >
          {stage.label}
        </span>
      </div>

      {/* 본문 */}
      {meta.length > 0 ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RulerIcon className="size-3 shrink-0" />
          <span className="truncate">{meta.join(" · ")}</span>
        </div>
      ) : null}

      {/* 하단: 매입처 / 액션 */}
      {isDemo && isAwarded ? (
        // 철거·해체 낙찰 확정 → 낙찰사(철거업체)에 전화 (강조)
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-50 p-2.5 dark:bg-emerald-950/40">
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <RecycleIcon className="size-4 shrink-0" />
            {p.awarded_company ?? p.contact_party ?? "철거업체"}
            <span className="text-xs font-normal opacity-80">(철거업체)</span>
            {dateStr ? (
              <span className="ml-auto shrink-0 text-xs font-normal tabular-nums opacity-80">낙찰 {dateStr}</span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-emerald-700/70 dark:text-emerald-300/70">고철·중고철근 매입 — 지금 전화</p>
        </div>
      ) : isDemo ? (
        // 철거·해체 낙찰 전 → 매입처(철거업체) 미정
        <div className="rounded-lg border bg-muted/40 p-2.5">
          <p className="text-xs text-muted-foreground">
            낙찰 전 — 발주처 <span className="font-medium text-foreground">{p.ordering_org ?? "미상"}</span>. 낙찰 시
            철거업체(매입처) 확정.
          </p>
        </div>
      ) : (
        // 민간 준공 → 건축주/시공사 + 배송 추정
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/50 p-2.5 dark:bg-emerald-950/30">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <PhoneCallIcon className="size-4 shrink-0 text-emerald-600" />
            {p.contact_party ?? "건축주/시공사"}
            <span className="ml-auto inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground">
              <TruckIcon className="size-3" />
              {DELIVERY_LABEL[tier]}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">남은 철근 매입{dateStr ? ` · 준공 ${dateStr}` : ""}</p>
        </div>
      )}
    </div>
  );
}
