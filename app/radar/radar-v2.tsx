"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Building2Icon,
  CarFrontIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PhoneCallIcon,
  RotateCcwIcon,
  StarIcon,
} from "lucide-react";
import { QuoteButton, type QuoteSources } from "@/components/admin/quote-dialog";
import { PartnerFormDialog, type PartnerPrefill } from "@/app/[book]/partners/partner-form-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  BAND_LABEL,
  BAND_SUB,
  DISTANCE_BANDS,
  PERMANENT_DISMISS_REASON,
  RESULT_REFUSED,
  STATUS_LABEL,
  normalizeResultCode,
  type DistanceBand,
  type RowStatus,
} from "@/lib/radar/v2-rules";
import { formatPhone } from "@/lib/format";
import type { VisitViewRow } from "@/lib/radar/visit-view";
import { cn } from "@/lib/utils";
import { restoreRadarProject } from "./actions";
import { DismissDialog, TouchDialog, type TouchTarget } from "./touch-dialog";

type Tab = "visit" | "phone";
const STATUSES: readonly RowStatus[] = ["today", "waiting", "done"] as const;
const CHANNEL_LABEL: Record<string, string> = { phone: "전화", visit: "방문", email: "이메일", sms: "문자" };

/** timestamptz → KST "MM.DD HH:mm". */
function fmtKst(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(/\. /g, ".")
    .replace(/\.$/, "")
    .replace(/(\d{2})\.(\d{2})\.?\s?(\d{2}:\d{2})/, "$1.$2 $3");
}
/** "YYYY-MM-DD" → "MM/DD". */
const fmtMD = (d: string | null | undefined) => (d ? d.slice(5).replace("-", "/") : "—");
const fmtArea = (a: number | null) => (a == null ? "" : `${Math.round(a).toLocaleString("ko-KR")}㎡`);

/**
 * 발주 레이더 v2 화면 — 축 2개(탭 · 상태 칩), 상단 숫자 1개("오늘 N").
 * 방문 탭: 경주 민간 현장을 거리 밴드로 묶고, 밴드 안에서 착공 → '착공 전(허가)'(접힘) 순.
 * 전화 탭: 2주 콜 캠페인 판정 뒤 구현(기획안 §9 D10) — 지금은 CSV 안내만.
 */
export function RadarV2({
  rows,
  today,
  synced,
  quoteSources,
  quoteSourcesError,
  focusId,
}: {
  rows: VisitViewRow[];
  today: string;
  synced: { building: string | null; nara: string | null };
  quoteSources: QuoteSources;
  /** [견적] 폼 데이터 조회 실패 — 있으면 [견적]을 잠그고 안내 */
  quoteSourcesError?: string | null;
  /** 영업내역 '레이더' 링크(?focus=) — 그 행의 상태 칩을 열고 펼쳐서 보여준다 */
  focusId?: string | null;
}) {
  const focusRow = focusId ? (rows.find((r) => r.id === focusId) ?? null) : null;
  const [tab, setTab] = useState<Tab>("visit");
  const [status, setStatus] = useState<RowStatus>(focusRow?.status ?? "today");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(focusRow ? new Set([focusRow.id]) : new Set());
  const [permitOpen, setPermitOpen] = useState<ReadonlySet<DistanceBand>>(
    focusRow && focusRow.stage === "permit" ? new Set([focusRow.band]) : new Set(),
  );
  const [touch, setTouch] = useState<TouchTarget | null>(null);
  const [dismiss, setDismiss] = useState<TouchTarget | null>(null);
  const [partnerPrefill, setPartnerPrefill] = useState<PartnerPrefill | null>(null);

  // 포커스 행으로 스크롤 — 처음 한 번만(다른 행 저장으로 목록이 갱신돼도 화면을 되돌리지 않음)
  const focusRowId = focusRow?.id ?? null;
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!focusRowId || scrolledRef.current) return;
    scrolledRef.current = true;
    document.getElementById(`radar-row-${focusRowId}`)?.scrollIntoView({ block: "center" });
  }, [focusRowId]);

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { today: 0, waiting: 0, done: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);
  const visible = useMemo(() => rows.filter((r) => r.status === status), [rows, status]);
  const byBand = useMemo(() => {
    const m = new Map<DistanceBand, { start: VisitViewRow[]; permit: VisitViewRow[] }>();
    for (const b of DISTANCE_BANDS) m.set(b, { start: [], permit: [] });
    for (const r of visible) m.get(r.band)![r.stage === "construction_start" ? "start" : "permit"].push(r);
    return m;
  }, [visible]);

  const toggle = <T,>(set: ReadonlySet<T>, v: T): ReadonlySet<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">발주 레이더</h1>
        <p className="text-sm text-muted-foreground">
          경주 — 오늘 방문할 현장 · 오늘 걸 전화. 행은 [기록]·[제외]로만 사라집니다. 오늘이 비어 있는 게 정상입니다.
        </p>
        <p className="text-xs text-muted-foreground">
          동기화 건축 {fmtKst(synced.building)} · 나라장터 {fmtKst(synced.nara)}
        </p>
      </header>

      {/* 축 ① 탭 */}
      <div className="flex items-center gap-2">
        <TabBtn active={tab === "visit"} onClick={() => setTab("visit")} icon={CarFrontIcon} label="방문" count={rows.length} />
        <TabBtn active={tab === "phone"} onClick={() => setTab("phone")} icon={PhoneCallIcon} label="전화" hint="판정 후" />
        <div className="ml-auto text-right">
          <div className="text-2xl font-semibold tabular-nums leading-none">{counts.today}</div>
          <div className="text-[11px] text-muted-foreground">오늘</div>
        </div>
      </div>

      {quoteSourcesError ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          견적 데이터(거래처·품목)를 불러오지 못해 [견적]을 잠시 쓸 수 없습니다: {quoteSourcesError}
        </p>
      ) : null}

      {focusId && !focusRow ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          링크한 레이더 행이 방문 목록에 없습니다 — 전화(낙찰사) 기록이거나 목록 기간이 지난 행입니다.
        </p>
      ) : null}

      {tab === "phone" ? (
        <PhonePlaceholder />
      ) : (
        <>
          {/* 축 ② 상태 칩 */}
          <div className="flex gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  status === s ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {STATUS_LABEL[s]}
                <span className={cn("tabular-nums", status === s ? "opacity-80" : "opacity-60")}>{counts[s]}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              {status === "today"
                ? "오늘 처리할 행이 없습니다 — 다음 동기화: 매주 일요일 오전(보통 09~11시)"
                : status === "waiting"
                  ? "대기 중인 행이 없습니다."
                  : "제외한 행이 없습니다(최근 90일)."}
            </p>
          ) : (
            DISTANCE_BANDS.map((band) => {
              const g = byBand.get(band)!;
              if (g.start.length + g.permit.length === 0) return null;
              const permitShown = permitOpen.has(band) || g.start.length === 0;
              return (
                <section key={band} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2 px-1">
                    <h2 className="text-sm font-semibold">
                      {BAND_LABEL[band]}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{BAND_SUB[band]}</span>
                    </h2>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      착공 {g.start.length} · 착공 전 {g.permit.length}
                    </span>
                  </div>
                  {g.start.map((r) => (
                    <VisitCard
                      key={r.id}
                      r={r}
                      expanded={expanded.has(r.id)}
                      onToggle={() => setExpanded(toggle(expanded, r.id))}
                      onTouch={() => setTouch({ id: r.id, label: r.address, channel: "visit" })}
                      onDismiss={() => setDismiss({ id: r.id, label: r.address, channel: "visit" })}
                      onPartner={() => setPartnerPrefill(partnerPrefillOf(r))}
                      quoteSources={quoteSources}
                      quoteDisabled={!!quoteSourcesError}
                      focused={r.id === focusRow?.id}
                    />
                  ))}
                  {g.permit.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setPermitOpen(toggle(permitOpen, band))}
                        className="inline-flex w-fit items-center gap-1 px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        {permitShown ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
                        착공 전(허가) {g.permit.length} — 선점 · 착공되면 다시 “오늘”
                      </button>
                      {permitShown
                        ? g.permit.map((r) => (
                            <VisitCard
                              key={r.id}
                              r={r}
                              expanded={expanded.has(r.id)}
                              onToggle={() => setExpanded(toggle(expanded, r.id))}
                              onTouch={() => setTouch({ id: r.id, label: r.address, channel: "visit" })}
                              onDismiss={() => setDismiss({ id: r.id, label: r.address, channel: "visit" })}
                              onPartner={() => setPartnerPrefill(partnerPrefillOf(r))}
                              quoteSources={quoteSources}
                              quoteDisabled={!!quoteSourcesError}
                              focused={r.id === focusRow?.id}
                            />
                          ))
                        : null}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </>
      )}

      {/* key 로 대상별 새 인스턴스 → 폼 상태 초기화(effect 없이) */}
      <TouchDialog key={touch?.id ?? "touch-none"} target={touch} today={today} onOpenChange={(o) => !o && setTouch(null)} />
      <DismissDialog key={dismiss?.id ?? "dismiss-none"} target={dismiss} onOpenChange={(o) => !o && setDismiss(null)} />
      <PartnerFormDialog
        open={!!partnerPrefill}
        onOpenChange={(o) => !o && setPartnerPrefill(null)}
        editing={null}
        prefill={partnerPrefill}
      />
    </div>
  );
}

/** [거래처로] 미리 채우기 — 방문 기록에서 확보한 업체명·담당자 전화, 메모에 현장 주소. */
function partnerPrefillOf(r: VisitViewRow): PartnerPrefill {
  return {
    from_radar_id: r.id,
    name: r.companyHint ?? "",
    phone: r.contactPhone,
    industry: "건설업",
    notes: `발주 레이더 현장: ${r.address}${r.contactName ? ` · 담당 ${r.contactName}` : ""}`,
  };
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
      {count != null ? <span className={cn("tabular-nums text-xs", active ? "opacity-80" : "opacity-60")}>{count}</span> : null}
      {hint ? <span className={cn("text-[11px]", active ? "opacity-80" : "opacity-60")}>({hint})</span> : null}
    </button>
  );
}

function VisitCard({
  r,
  expanded,
  onToggle,
  onTouch,
  onDismiss,
  onPartner,
  quoteSources,
  quoteDisabled,
  focused,
}: {
  r: VisitViewRow;
  expanded: boolean;
  onToggle: () => void;
  onTouch: () => void;
  onDismiss: () => void;
  onPartner: () => void;
  quoteSources: QuoteSources;
  quoteDisabled?: boolean;
  focused?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const isStart = r.stage === "construction_start";
  const isDone = r.status === "done";
  const restorable = isDone && r.restorable;
  const who = r.contactName || r.contactPhone
    ? [r.contactName, formatPhone(r.contactPhone)].filter(Boolean).join(" ")
    : "미상 → 표지판 확인";

  function restore() {
    startTransition(async () => {
      const res = await restoreRadarProject(r.id);
      if (res.ok) toast.success("복구했습니다");
      else toast.error(res.error);
    });
  }

  return (
    <div
      id={`radar-row-${r.id}`}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border bg-card p-3 text-sm ring-1 ring-foreground/5",
        isDone && "opacity-70",
        focused && "ring-2 ring-sky-500/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium leading-snug">
            <span className={cn("mr-1.5 rounded px-1 text-[11px]", isStart ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300")}>
              {isStart ? "착공" : "허가"} {r.days != null ? `${r.days}일째` : ""}
              {!isStart ? " · 착공 전" : ""}
            </span>
            {r.address}
          </div>
          {r.titleHint ? <div className="truncate text-xs text-muted-foreground">{r.titleHint}</div> : null}
          {r.partnerName ? (
            <div className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <StarIcon className="size-3" /> 거래처 {r.partnerName}
            </div>
          ) : null}
          <div className="text-xs text-muted-foreground">
            {[r.mainPurps, fmtArea(r.floorArea), r.archGb].filter(Boolean).join(" · ")}
            <span className="mx-1">·</span>누구: <span className={r.contactName || r.contactPhone ? "text-foreground" : ""}>{who}</span>
          </div>
          {r.lastLog ? (
            <div className="text-xs">
              {fmtMD(r.lastLog.contacted_on)} {CHANNEL_LABEL[r.lastLog.channel ?? ""] ?? r.lastLog.channel} “{r.lastLog.result}”
              {r.lastLog.contact_person ? ` ${r.lastLog.contact_person}` : ""}
              {r.lastLog.follow_up_on ? <span className="text-muted-foreground"> → 다음 {fmtMD(r.lastLog.follow_up_on)}</span> : null}
            </div>
          ) : null}
          {isDone ? (
            <div className="text-xs text-muted-foreground">
              {r.dismissedAt ? `제외 ${fmtKst(r.dismissedAt)} · ${r.dismissReason ?? "—"}` : "거절 기록됨 — 제외 처리 대기(수집 시 자동)"}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {isDone ? (
          restorable ? (
            <Button type="button" size="sm" variant="outline" onClick={restore} disabled={pending}>
              <RotateCcwIcon className="size-3.5" /> 복구
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {r.dismissReason === PERMANENT_DISMISS_REASON ||
              !r.dismissedAt ||
              r.logs.some((l) => normalizeResultCode(l.result) === RESULT_REFUSED)
                ? "복구 불가(수신거부 보장)"
                : "복구 불가 — 반영 60일이 지나 복구해도 목록에 남지 않음"}
            </span>
          )
        ) : (
          <>
            <Button type="button" size="sm" onClick={onTouch}>
              방문 기록
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
              제외
            </Button>
          </>
        )}
        <button type="button" onClick={onToggle} className="ml-auto inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
          {expanded ? "접기" : "펼치기"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-1 flex flex-col gap-1.5 border-t pt-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>반영 {fmtKst(r.stageChangedAt)}</span>
            <span>허가 {r.permitDate ?? "—"}</span>
            <span>착공 {r.startDate ?? "—"}</span>
            <span>주용도 {r.mainPurps ?? "—"}</span>
            <span>읍면동 {r.emd ?? "—"}</span>
            <a href={r.mapUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline">
              <ExternalLinkIcon className="size-3" /> 지도 검색
            </a>
          </div>
          {!isDone ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {quoteDisabled ? null : (
                <QuoteButton
                  sources={quoteSources}
                  book="all"
                  defaultPartnerName={r.partnerName ?? r.companyHint ?? ""}
                  defaultSiteName={r.address}
                  sourceProjectId={r.id}
                  label="견적"
                  variant="outline"
                />
              )}
              {r.partnerName ? null : (
                <Button type="button" size="sm" variant="outline" onClick={onPartner}>
                  <Building2Icon className="size-3.5" /> 거래처로
                </Button>
              )}
              <span className="text-[11px]">견적 문자는 상대가 요청한 경우(“견적 요청” 기록 뒤)에만 보낼 수 있습니다.</span>
            </div>
          ) : null}
          {r.logs.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {r.logs.map((l, i) => (
                <li key={`${l.created_at}-${i}`}>
                  {l.contacted_on} {CHANNEL_LABEL[l.channel ?? ""] ?? l.channel ?? ""} “{l.result ?? "—"}”
                  {l.contact_person ? ` · ${l.contact_person}` : ""}
                  {l.contact_phone ? ` ${formatPhone(l.contact_phone)}` : ""}
                  {l.notes ? ` · ${l.notes}` : ""}
                  {l.follow_up_on ? ` → ${l.follow_up_on}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <span>기록 없음</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PhonePlaceholder() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed bg-muted/30 p-5 text-sm">
      <p className="font-medium">전화 탭은 2주 콜 캠페인 판정 뒤 붙습니다 (통화 성사 계정 중 견적 요청 3건 이상).</p>
      <p className="text-muted-foreground">
        지금은 화면 없이 바로 겁니다 — <code className="rounded bg-muted px-1">npm run radar:v2:export</code> 로 뽑은{" "}
        <code className="rounded bg-muted px-1">radar-v2-전화목록-날짜.csv</code>(경주 소재 낙찰사 30일 + RC 낙찰 90일, 약 30계정).
      </p>
      <p className="text-muted-foreground">
        기록은 영업내역 페이지에: 잠재 거래처명=낙찰사, 채널=전화, 결과=견적 요청 / 다음에 / 철근 안 씀·거절 / 현장 없음·연락 불가·폐업,
        메모 첫 줄 “레이더 {"{id}"}”(CSV 마지막 열).
      </p>
      <p className="text-muted-foreground">
        통화 첫 문장 고정: “나라장터 낙찰 정보(공공데이터)를 보고 연락드린 경주 ○○철강입니다”. 문자·MMS는 ‘견적 요청’ 기록 뒤에만.
      </p>
    </div>
  );
}
