"use server";

import { revalidatePath } from "next/cache";
import { addDays, addMonths, addYears, parseISO, formatISO } from "date-fns";
import { createClient } from "@/lib/supabase/server";

export type RecurringTaskActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

type Input = {
  title: string;
  cadence: string;
  due_rule: string | null;
  related_book: string | null;
  notes: string | null;
  next_due_date: string | null;
  is_active: boolean;
};

function readInput(formData: FormData): Input {
  const str = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };
  return {
    title: str("title") ?? "",
    cadence: str("cadence") ?? "adhoc",
    due_rule: str("due_rule"),
    related_book: str("related_book"),
    notes: str("notes"),
    next_due_date: str("next_due_date"),
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
  };
}

function friendly(message: string): string {
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
}

function bumpRevalidation() {
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/recurring-tasks`);
  }
}

/** cadence에 따라 다음 due 날짜 계산. adhoc은 그대로 반환 (수동 갱신). */
function bumpNextDue(currentDue: string | null, cadence: string): string | null {
  if (!currentDue) return null;
  const base = parseISO(currentDue);
  let next: Date;
  switch (cadence) {
    case "daily":
      next = addDays(base, 1);
      break;
    case "weekly":
      next = addDays(base, 7);
      break;
    case "monthly":
      next = addMonths(base, 1);
      break;
    case "yearly":
      next = addYears(base, 1);
      break;
    case "adhoc":
    default:
      return currentDue;
  }
  return formatISO(next, { representation: "date" });
}

export async function createRecurringTask(formData: FormData): Promise<RecurringTaskActionResult> {
  const input = readInput(formData);
  if (!input.title) return { ok: false, error: "제목은 필수입니다." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("recurring_task")
    .insert({ ...input, owner: user?.id ?? null })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id: data.id };
}

export async function updateRecurringTask(
  id: string,
  formData: FormData,
): Promise<RecurringTaskActionResult> {
  const input = readInput(formData);
  if (!input.title) return { ok: false, error: "제목은 필수입니다." };

  const supabase = await createClient();
  const { error } = await supabase.from("recurring_task").update(input).eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id };
}

export async function deleteRecurringTask(id: string): Promise<RecurringTaskActionResult> {
  const supabase = await createClient();
  // recurring_task에는 deleted_at 없음 → is_active=false 로 비활성 (히스토리 보존)
  const { error } = await supabase
    .from("recurring_task")
    .update({ is_active: false })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id };
}

/**
 * 완료 표시 — recurring_task_log에 INSERT + cadence 따라 next_due_date 자동 갱신.
 * doneOn 미지정 시 오늘(KST).
 */
export async function markRecurringTaskDone(
  taskId: string,
  doneOn?: string,
  notes?: string | null,
): Promise<RecurringTaskActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const done = doneOn ?? today;

  // 1) log INSERT
  const { error: logErr } = await supabase
    .from("recurring_task_log")
    .insert({ task_id: taskId, done_on: done, done_by: user?.id ?? null, notes: notes ?? null });
  if (logErr) return { ok: false, error: friendly(logErr.message) };

  // 2) task의 next_due_date 갱신 (cadence 기반)
  const { data: task } = await supabase
    .from("recurring_task")
    .select("cadence, next_due_date")
    .eq("id", taskId)
    .single();

  if (task) {
    const base = task.next_due_date ?? done;
    const newNext = bumpNextDue(base, task.cadence);
    if (newNext && newNext !== task.next_due_date) {
      await supabase.from("recurring_task").update({ next_due_date: newNext }).eq("id", taskId);
    }
  }

  bumpRevalidation();
  return { ok: true, id: taskId };
}

/** 완료 이력 1건 취소 (가장 최근 done_on 삭제). next_due_date는 자동 되돌리지 않음. */
export async function unmarkRecurringTaskDone(
  taskId: string,
  logId: string,
): Promise<RecurringTaskActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("recurring_task_log").delete().eq("id", logId);
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id: taskId };
}
