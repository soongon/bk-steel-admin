"use client";

import { MapPinIcon, PhoneCallIcon, RulerIcon, TriangleAlertIcon } from "lucide-react";
import {
  RADAR_STAGE_META,
  RELEVANCE_GRADE_META,
  RADAR_SOURCE_LABEL,
  STRUCTURE_LABEL,
  USAGE_LABEL,
  type RadarProjectRow,
} from "@/lib/radar/types";
import { cn } from "@/lib/utils";

const tonText = (t: number | null) => (t == null ? null : `약 ${Math.round(t).toLocaleString("ko-KR")}톤`);
const areaText = (a: number | null) =>
  a == null ? null : `${Math.round(a).toLocaleString("ko-KR")}㎡`;

/**
 * 발주 현장 카드.
 * 헤더: 소스·등급 뱃지 + 현장명 + 주소·거리 + 단계 칩(색=긴급도).
 * 본문: 용도/구조·연면적·추정 철근톤.
 * 하단: **연락 주체** — 관급 낙찰사는 파란 띠로 강조하고 "발주처(시청) 아님"을 명시해
 *       영업이 발주처에 전화하는 실수를 구조적으로 막는다.
 */
export function ProjectCard({ p }: { p: RadarProjectRow }) {
  const stage = RADAR_STAGE_META[p.stage];
  const grade = p.relevance_grade ? RELEVANCE_GRADE_META[p.relevance_grade] : null;
  const isPublic = p.source === "nara_bid";
  const isAwarded = p.stage === "awarded";

  const meta = [
    p.usage ? (USAGE_LABEL[p.usage] ?? p.usage) : null,
    p.structure ? STRUCTURE_LABEL[p.structure] : null,
    areaText(p.floor_area),
    tonText(p.est_rebar_ton),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 ring-1 ring-foreground/10">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-md border px-1.5 text-xs",
                isPublic
                  ? "border-violet-500/40 bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                  : "border-emerald-500/40 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
              )}
            >
              {RADAR_SOURCE_LABEL[p.source]}
            </span>
            {grade ? (
              <span
                className={cn(
                  "inline-flex h-5 items-center rounded-md border px-1.5 text-xs font-semibold",
                  grade.className,
                )}
              >
                {grade.label}
              </span>
            ) : null}
          </div>
          <h3 className="mt-1 truncate font-medium" title={p.title}>
            {p.title}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPinIcon className="size-3 shrink-0" />
            <span className="truncate">{p.address ?? "주소 미상"}</span>
            {p.distance_km != null ? (
              <span className="shrink-0 tabular-nums">· {Math.round(p.distance_km)}km</span>
            ) : null}
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

      {/* 하단: 연락 주체 */}
      {isPublic && isAwarded ? (
        // 관급 낙찰 확정 → 낙찰사에 전화 (강조)
        <div className="rounded-lg border border-blue-500/40 bg-blue-50 p-2.5 dark:bg-blue-950/40">
          <p className="flex items-center gap-1.5 text-sm font-medium text-blue-700 dark:text-blue-300">
            <PhoneCallIcon className="size-4 shrink-0" />
            {p.awarded_company ?? p.contact_party ?? "낙찰사"}
            <span className="text-xs font-normal opacity-80">(낙찰사)</span>
          </p>
          {p.ordering_org ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-blue-700/70 dark:text-blue-300/70">
              <TriangleAlertIcon className="size-3 shrink-0" />
              발주처 {p.ordering_org} — 연락 대상 아님
            </p>
          ) : null}
        </div>
      ) : isPublic ? (
        // 관급 낙찰 전 → 아직 연락 대상 미정
        <div className="rounded-lg border bg-muted/40 p-2.5">
          <p className="text-xs text-muted-foreground">
            낙찰 전 — 발주처 <span className="font-medium text-foreground">{p.ordering_org ?? "미상"}</span>
            . 낙찰 시 연락처(낙찰사) 확정.
          </p>
        </div>
      ) : (
        // 민간 → 건축주/시공사
        <div
          className={cn(
            "rounded-lg border p-2.5",
            stage.urgency === "now"
              ? "border-red-500/40 bg-red-50 dark:bg-red-950/40"
              : "bg-muted/40",
          )}
        >
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm font-medium",
              stage.urgency === "now" ? "text-red-700 dark:text-red-300" : "text-foreground",
            )}
          >
            <PhoneCallIcon className="size-4 shrink-0" />
            {p.contact_party ?? "건축주/시공사"}
            {stage.urgency === "now" ? (
              <span className="text-xs font-normal opacity-80">· 착공 — 지금 전화</span>
            ) : null}
          </p>
        </div>
      )}
    </div>
  );
}
