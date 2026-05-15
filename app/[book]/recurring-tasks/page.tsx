import { createClient } from "@/lib/supabase/server";
import { RecurringTaskViews, type TaskWithMeta } from "./recurring-task-views";

export default async function RecurringTasksPage() {
  const supabase = await createClient();

  const { data: tasksData, error } = await supabase
    .from("recurring_task")
    .select("id, title, cadence, due_rule, related_book, notes, next_due_date, is_active")
    .order("is_active", { ascending: false })
    .order("next_due_date", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true });

  const tasks = tasksData ?? [];
  const ids = tasks.map((t) => t.id);

  // 각 task의 마지막 완료 이력 — DESC 정렬 후 첫 row가 최신
  const { data: logsData } = ids.length
    ? await supabase
        .from("recurring_task_log")
        .select("task_id, done_on")
        .in("task_id", ids)
        .order("done_on", { ascending: false })
    : { data: [] as { task_id: string; done_on: string }[] };

  const lastDoneMap = new Map<string, string>();
  for (const log of logsData ?? []) {
    if (!lastDoneMap.has(log.task_id)) {
      lastDoneMap.set(log.task_id, log.done_on);
    }
  }

  const rows: TaskWithMeta[] = tasks.map((t) => ({
    ...t,
    last_done_on: lastDoneMap.get(t.id) ?? null,
  }));

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">정기업무</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            반복 주기별 업무 추적 — 완료 체크 시 다음 예정일 자동 갱신
          </p>
        </div>
        <span className="inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
          공유 마스터
        </span>
      </header>

      {error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          데이터 로딩 실패: {error.message}
        </div>
      ) : (
        <RecurringTaskViews tasks={rows} />
      )}
    </div>
  );
}
