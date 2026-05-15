"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ko } from "date-fns/locale";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type CalendarEventTone = "default" | "overdue" | "done" | "planned" | "muted";

export type CalendarEvent = {
  id: string;
  date: string; // 'yyyy-MM-dd'
  title: string;
  tone?: CalendarEventTone;
  /** 클릭 시 부모에게 전달되는 원본 데이터 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
};

const TONE_CLASS: Record<CalendarEventTone, string> = {
  default: "bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-950/60 dark:text-blue-200 dark:hover:bg-blue-900/60",
  overdue: "bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/60",
  done: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:hover:bg-emerald-900/60",
  planned: "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-900/60",
  muted: "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-700/60",
};

const WEEKDAYS_KR = ["월", "화", "수", "목", "금", "토", "일"];

type Props = {
  events: CalendarEvent[];
  /** 선택된 날짜 (controlled) */
  selectedDate?: Date | null;
  onSelectDate?: (date: Date) => void;
  /** 표시할 월 (controlled). 미제공 시 internal state */
  visibleMonth?: Date;
  onMonthChange?: (date: Date) => void;
  /** 셀당 최대 표시 event 수 — 초과 시 +N more */
  maxEventsPerCell?: number;
  onEventClick?: (event: CalendarEvent) => void;
  /** 셀 우상단 + 버튼 클릭 시. 미제공 시 버튼 안 보임 */
  onCreateOnDate?: (date: Date) => void;
  className?: string;
};

export function EventCalendar({
  events,
  selectedDate,
  onSelectDate,
  visibleMonth,
  onMonthChange,
  maxEventsPerCell = 3,
  onEventClick,
  onCreateOnDate,
  className,
}: Props) {
  const [internalMonth, setInternalMonth] = useState<Date>(
    visibleMonth ?? startOfMonth(new Date()),
  );
  const month = visibleMonth ?? internalMonth;

  function setMonth(d: Date) {
    if (visibleMonth) onMonthChange?.(d);
    else setInternalMonth(d);
  }

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    return map;
  }, [events]);

  // 월 전체 + 첫주 prev / 마지막주 next 채워서 6주 grid (한국 관습: 월요일 시작)
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [month]);

  const today = new Date();

  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <Button size="icon-sm" variant="ghost" onClick={() => setMonth(subMonths(month, 1))} aria-label="이전 달">
          <ChevronLeftIcon />
        </Button>
        <h3 className="text-sm font-medium">
          {format(month, "yyyy년 M월", { locale: ko })}
        </h3>
        <Button size="icon-sm" variant="ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="다음 달">
          <ChevronRightIcon />
        </Button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 border-b text-xs">
        {WEEKDAYS_KR.map((wd, i) => (
          <div
            key={wd}
            className={cn(
              "p-2 text-center text-muted-foreground",
              i === 5 && "text-blue-600 dark:text-blue-400",
              i === 6 && "text-rose-600 dark:text-rose-400",
            )}
          >
            {wd}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const dateKey = format(d, "yyyy-MM-dd");
          const cellEvents = eventsByDate.get(dateKey) ?? [];
          const isCurrentMonth = isSameMonth(d, month);
          const isToday = isSameDay(d, today);
          const isSelected = !!selectedDate && isSameDay(d, selectedDate);
          // 월=0 ~ 일=6 (date-fns getDay: 일=0 ~ 토=6)
          const dayOfWeek = (d.getDay() + 6) % 7;

          const visible = cellEvents.slice(0, maxEventsPerCell);
          const overflow = cellEvents.length - visible.length;

          return (
            <div
              key={dateKey}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDate?.(d)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectDate?.(d);
                }
              }}
              className={cn(
                "group/cell relative flex min-h-24 cursor-pointer flex-col gap-0.5 border-b border-r p-1.5 text-xs transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                !isCurrentMonth && "bg-muted/20 text-muted-foreground",
                isSelected && "ring-2 ring-inset ring-primary",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "tabular-nums",
                    isCurrentMonth && dayOfWeek === 5 && "text-blue-600 dark:text-blue-400",
                    isCurrentMonth && dayOfWeek === 6 && "text-rose-600 dark:text-rose-400",
                    isToday && "inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
                  )}
                >
                  {d.getDate()}
                </span>
                {onCreateOnDate ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreateOnDate(d);
                    }}
                    aria-label="이 날짜에 추가"
                    className="rounded p-0.5 opacity-0 hover:bg-muted group-hover/cell:opacity-100"
                  >
                    <PlusIcon className="size-3" />
                  </button>
                ) : null}
              </div>
              {visible.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onEventClick?.(e);
                  }}
                  title={e.title}
                  className={cn(
                    "truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight",
                    TONE_CLASS[e.tone ?? "default"],
                  )}
                >
                  {e.title}
                </button>
              ))}
              {overflow > 0 ? (
                <span className="px-1 text-[10px] text-muted-foreground">+{overflow}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
