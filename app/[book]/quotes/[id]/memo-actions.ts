"use server";

import { revalidatePath } from "next/cache";
import { insertMemo, removeMemo } from "@/lib/memo-log-server";
import { type MemoAddResult, type MemoDeleteResult } from "@/lib/memo-log";

// 상세 화면만 다시 그린다 — 견적서 메모는 목록·문서와 무관.
const refresh = () => revalidatePath("/[book]/quotes/[id]", "page");

export async function addQuoteMemo(quoteId: string, body: string): Promise<MemoAddResult> {
  const r = await insertMemo("quote", quoteId, body);
  if (r.ok) refresh();
  return r;
}

export async function deleteQuoteMemo(memoId: string): Promise<MemoDeleteResult> {
  const r = await removeMemo("quote", memoId);
  if (r.ok) refresh();
  return r;
}
