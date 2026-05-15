"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type IdeaActionResult = { ok: true; id?: string } | { ok: false; error: string };

type Input = {
  title: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  status: string;
  notes: string | null;
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
    description: str("description"),
    category: str("category"),
    priority: str("priority"),
    status: str("status") ?? "open",
    notes: str("notes"),
  };
}

function friendly(message: string): string {
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
}

function bumpRevalidation() {
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/improvement-ideas`);
  }
}

/** status='done' 으로 바뀔 때 resolved_at 자동 set, 다시 풀리면 null */
function resolvedAtFor(status: string, currentResolvedAt: string | null): string | null | undefined {
  if (status === "done") {
    return currentResolvedAt ?? new Date().toISOString();
  }
  if (currentResolvedAt) return null;
  return undefined; // 변경 없음
}

export async function createIdea(formData: FormData): Promise<IdeaActionResult> {
  const input = readInput(formData);
  if (!input.title) return { ok: false, error: "제목은 필수입니다." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const payload: Record<string, unknown> = {
    ...input,
    proposed_by: user?.id ?? null,
  };
  if (input.status === "done") payload.resolved_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("improvement_idea")
    .insert(payload)
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id: data.id };
}

export async function updateIdea(
  id: string,
  formData: FormData,
): Promise<IdeaActionResult> {
  const input = readInput(formData);
  if (!input.title) return { ok: false, error: "제목은 필수입니다." };

  const supabase = await createClient();

  // 기존 resolved_at 읽어서 status 변화 시 동기화
  const { data: current } = await supabase
    .from("improvement_idea")
    .select("resolved_at")
    .eq("id", id)
    .single();

  const payload: Record<string, unknown> = { ...input };
  const newResolved = resolvedAtFor(input.status, current?.resolved_at ?? null);
  if (newResolved !== undefined) payload.resolved_at = newResolved;

  const { error } = await supabase.from("improvement_idea").update(payload).eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id };
}

/** 행에서 직접 status만 변경 (체크박스/select inline) */
export async function setIdeaStatus(id: string, status: string): Promise<IdeaActionResult> {
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("improvement_idea")
    .select("resolved_at")
    .eq("id", id)
    .single();

  const payload: Record<string, unknown> = { status };
  const newResolved = resolvedAtFor(status, current?.resolved_at ?? null);
  if (newResolved !== undefined) payload.resolved_at = newResolved;

  const { error } = await supabase.from("improvement_idea").update(payload).eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id };
}

/** 영구 삭제 (improvement_idea엔 deleted_at 컬럼 없음) */
export async function deleteIdea(id: string): Promise<IdeaActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("improvement_idea").delete().eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id };
}
