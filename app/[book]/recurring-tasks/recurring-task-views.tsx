"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  CheckIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EventCalendar,
  type CalendarEvent,
} from "@/components/admin/event-calendar/event-calendar";
import { BOOK_LABEL } from "@/lib/book";
import {
  RecurringTaskFormDialog,
  CADENCE_LABEL,
  type RecurringTaskRow,
} from "./recurring-task-form-dialog";
import { deleteRecurringTask, markRecurringTaskDone } from "./actions";

export type TaskWithMeta = RecurringTaskRow & {
  last_done_on: string | null;
};

type View = "calendar" | "list";

const todayKst = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

export function RecurringTaskViews({ tasks }: { tasks: TaskWithMeta[] }) {
  const router = useRouter();
  const [view, setView] = useState<View>("calendar");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTaskRow | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(
    () => new Date(todayKst()),
  );
  const [, startTransition] = useTransition();

  const today = todayKst();

  // 캘린더용 events 변환
  const events: CalendarEvent[] = useMemo(() => {
    return tasks
      .filter((t) => t.next_due_date && t.is_active)
      .map((t) => ({
        id: t.id,
        date: t.next_due_date!,
        title: t.title,
        tone: t.next_due_date! < today ? ("overdue" as const) : ("default" as const),
        data: t,
      }));
  }, [tasks, today]);

  // 선택 날짜의 task 목록 (active 우선, 그 외 비활성도 같은 날짜면 노출)
  const selectedKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const selectedTasks = useMemo(
    () => tasks.filter((t) => t.next_due_date === selectedKey),
    [tasks, selectedKey],
  );

  function openCreate(prefillDate?: string) {
    setEditing(null);
    setDefaultDate(prefillDate ?? null);
    setOpen(true);
  }
  function openEdit(t: RecurringTaskRow) {
    setEditing(t);
    setDefaultDate(null);
    setOpen(true);
  }
  function handleDelete(t: RecurringTaskRow) {
    if (!window.confirm(`[${t.title}] 비활성화하시겠습니까? (히스토리 보존)`)) return;
    startTransition(async () => {
      const result = await deleteRecurringTask(t.id);
      if (result.ok) {
        toast.success("비활성화되었습니다");
        router.refresh();
      } else toast.error(result.error);
    });
  }
  function handleDone(t: RecurringTaskRow) {
    startTransition(async () => {
      const result = await markRecurringTaskDone(t.id);
      if (result.ok) {
        toast.success("완료 처리됨");
        router.refresh();
      } else toast.error(result.error);
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          활성{" "}
          <span className="font-medium text-foreground">
            {tasks.filter((t) => t.is_active).length}
          </span>{" "}
          / 전체 <span className="font-medium text-foreground">{tasks.length}</span>건
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setView("calendar")}
              aria-label="캘린더 보기"
              className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs ${
                view === "calendar"
                  ? "bg-zinc-200 dark:bg-zinc-700"
                  : "text-muted-foreground"
              }`}
            >
              <LayoutGridIcon className="size-3.5" />
              캘린더
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              aria-label="리스트 보기"
              className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs ${
                view === "list"
                  ? "bg-zinc-200 dark:bg-zinc-700"
                  : "text-muted-foreground"
              }`}
            >
              <ListIcon className="size-3.5" />
              리스트
            </button>
          </div>
          <Button onClick={() => openCreate()} size="sm">
            <PlusIcon className="size-4" />
            신규 정기업무
          </Button>
        </div>
      </div>

      {view === "calendar" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <EventCalendar
            events={events}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onCreateOnDate={(d) => openCreate(format(d, "yyyy-MM-dd"))}
            onEventClick={(e) => {
              if (e.data) openEdit(e.data as RecurringTaskRow);
            }}
          />
          <SelectedDatePanel
            selectedDate={selectedDate}
            tasks={selectedTasks}
            today={today}
            onCreate={() => openCreate(selectedKey)}
            onEdit={openEdit}
            onDone={handleDone}
            onDelete={handleDelete}
          />
        </div>
      ) : (
        <ListView
          tasks={tasks}
          today={today}
          onEdit={openEdit}
          onDone={handleDone}
          onDelete={handleDelete}
        />
      )}

      <RecurringTaskFormDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        defaultDate={defaultDate}
      />
    </>
  );
}

function SelectedDatePanel({
  selectedDate,
  tasks,
  today,
  onCreate,
  onEdit,
  onDone,
  onDelete,
}: {
  selectedDate: Date | null;
  tasks: TaskWithMeta[];
  today: string;
  onCreate: () => void;
  onEdit: (t: RecurringTaskRow) => void;
  onDone: (t: RecurringTaskRow) => void;
  onDelete: (t: RecurringTaskRow) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {selectedDate ? format(selectedDate, "yyyy년 M월 d일 (E)", { locale: ko }) : "—"}
        </h3>
        <Button size="xs" variant="outline" onClick={onCreate}>
          <PlusIcon className="size-3" />
          이 날짜에 추가
        </Button>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
          이 날짜에 예정된 정기업무가 없습니다
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => {
            const isOverdue = t.is_active && t.next_due_date && t.next_due_date < today;
            return (
              <li
                key={t.id}
                className="flex items-start justify-between gap-2 rounded-md border bg-background p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{t.title}</span>
                    <span className="inline-flex h-4 items-center rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                      {CADENCE_LABEL[t.cadence] ?? t.cadence}
                    </span>
                    {!t.is_active ? (
                      <span className="inline-flex h-4 items-center rounded bg-zinc-200 px-1.5 text-[10px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                        비활성
                      </span>
                    ) : null}
                    {isOverdue ? (
                      <span className="inline-flex h-4 items-center rounded bg-red-100 px-1.5 text-[10px] text-red-700 dark:bg-red-950/50 dark:text-red-300">
                        지남
                      </span>
                    ) : null}
                  </div>
                  {t.due_rule || t.notes ? (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {t.due_rule}
                      {t.due_rule && t.notes ? " · " : ""}
                      {t.notes}
                    </p>
                  ) : null}
                  {t.last_done_on ? (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      마지막 완료 {t.last_done_on}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button size="xs" variant="outline" onClick={() => onDone(t)} disabled={!t.is_active}>
                    <CheckIcon className="size-3" />
                    완료
                  </Button>
                  <div className="flex gap-1">
                    <Button size="icon-xs" variant="ghost" onClick={() => onEdit(t)} aria-label="수정">
                      <PencilIcon />
                    </Button>
                    <Button size="icon-xs" variant="ghost" onClick={() => onDelete(t)} aria-label="비활성화">
                      <Trash2Icon className="text-destructive" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ListView({
  tasks,
  today,
  onEdit,
  onDone,
  onDelete,
}: {
  tasks: TaskWithMeta[];
  today: string;
  onEdit: (t: RecurringTaskRow) => void;
  onDone: (t: RecurringTaskRow) => void;
  onDelete: (t: RecurringTaskRow) => void;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>제목</TableHead>
            <TableHead className="w-20">주기</TableHead>
            <TableHead>규칙</TableHead>
            <TableHead className="w-24">관련 책</TableHead>
            <TableHead className="w-32">다음 예정</TableHead>
            <TableHead className="w-28">마지막 완료</TableHead>
            <TableHead className="w-44 text-right">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                등록된 정기업무가 없습니다
              </TableCell>
            </TableRow>
          ) : (
            tasks.map((t) => {
              const isOverdue =
                t.is_active && t.next_due_date && t.next_due_date < today;
              return (
                <TableRow key={t.id} className={!t.is_active ? "opacity-60" : ""}>
                  <TableCell className="font-medium">
                    {t.title}
                    {!t.is_active ? (
                      <span className="ml-2 inline-flex h-4 items-center rounded bg-zinc-200 px-1.5 text-[10px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                        비활성
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex h-5 items-center rounded bg-muted px-1.5 text-xs">
                      {CADENCE_LABEL[t.cadence] ?? t.cadence}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.due_rule ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {t.related_book
                      ? BOOK_LABEL[t.related_book as keyof typeof BOOK_LABEL]
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {t.next_due_date ? (
                      <span
                        className={cn(
                          "font-mono text-xs",
                          isOverdue && "font-semibold text-red-600 dark:text-red-400",
                        )}
                      >
                        {t.next_due_date}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">미정</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {t.last_done_on ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="outline" onClick={() => onDone(t)} disabled={!t.is_active}>
                        <CheckIcon className="size-3" />
                        완료
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => onEdit(t)} aria-label="수정">
                        <PencilIcon />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => onDelete(t)} aria-label="비활성화">
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
