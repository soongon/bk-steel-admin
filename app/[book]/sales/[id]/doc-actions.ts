"use server";

import { revalidatePath } from "next/cache";
import { syncTradeDocs } from "@/lib/trade-docs-server";
import { type TradeDocSyncResult } from "@/lib/trade-doc";

/** 매출 사진 올리기·빼기(0099) — 결과에 반영 뒤 목록이 오므로 상세는 다시 안 그린다. 목록 배지는 다음 방문 때 갱신. */
export async function syncSaleDocs(saleId: string, fd: FormData): Promise<TradeDocSyncResult> {
  const r = await syncTradeDocs("sale", saleId, fd);
  if (r.ok) revalidatePath("/[book]/sales", "page");
  return r;
}
