"use server";

import { revalidatePath } from "next/cache";
import { insertMemo, removeMemo } from "@/lib/memo-log-server";
import { type MemoAddResult, type MemoDeleteResult } from "@/lib/memo-log";

// 상세 화면만 다시 그린다 — 메모는 목록·대시보드 숫자와 무관(목록 배지는 다음 방문 때 갱신).
const refresh = () => revalidatePath("/[book]/purchases/[id]", "page");

export async function addPurchaseMemo(purchaseId: string, body: string): Promise<MemoAddResult> {
  const r = await insertMemo("purchase", purchaseId, body);
  if (r.ok) refresh();
  return r;
}

export async function deletePurchaseMemo(memoId: string): Promise<MemoDeleteResult> {
  const r = await removeMemo("purchase", memoId);
  if (r.ok) refresh();
  return r;
}
