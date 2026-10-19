"use server";

import { revalidatePath } from "next/cache";
import { insertMemo, removeMemo } from "@/lib/memo-log-server";
import { type MemoAddResult, type MemoDeleteResult } from "@/lib/memo-log";

// 상세 화면만 다시 그린다 — 메모는 목록·대시보드 숫자와 무관(목록 배지는 다음 방문 때 갱신).
const refresh = () => revalidatePath("/[book]/sales/[id]", "page");

export async function addSaleMemo(saleId: string, body: string): Promise<MemoAddResult> {
  const r = await insertMemo("sale", saleId, body);
  if (r.ok) refresh();
  return r;
}

export async function deleteSaleMemo(memoId: string): Promise<MemoDeleteResult> {
  const r = await removeMemo("sale", memoId);
  if (r.ok) refresh();
  return r;
}
