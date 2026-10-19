"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SALE_MEMO_COLUMNS, SALE_MEMO_MAX, type SaleMemo } from "@/lib/sale-memo";

export type SaleMemoResult = { ok: true; memo: SaleMemo } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendly(message: string): string {
  if (message.includes("row-level security")) return "권한이 없습니다 (이 책 staff 이상 필요).";
  if (message.includes("chk_sale_memo_body")) return `메모 내용을 입력해 주세요 (${SALE_MEMO_MAX.toLocaleString()}자 이내).`;
  if (message.includes("sale_memo_sale_id_fkey")) return "매출을 찾을 수 없습니다. 새로고침해 주세요.";
  return message;
}

// 상세 화면만 다시 그린다 — 메모는 목록·대시보드 숫자와 무관.
const refresh = () => revalidatePath("/[book]/sales/[id]", "page");

export async function addSaleMemo(saleId: string, body: string): Promise<SaleMemoResult> {
  if (!UUID_RE.test(saleId)) return { ok: false, error: "잘못된 매출입니다." };
  const text = body.trim();
  if (!text) return { ok: false, error: "메모 내용을 입력해 주세요." };
  if (text.length > SALE_MEMO_MAX) return { ok: false, error: `메모는 ${SALE_MEMO_MAX.toLocaleString()}자까지 쓸 수 있습니다.` };

  const supabase = await createClient();
  const { data, error } = await supabase.from("sale_memo").insert({ sale_id: saleId, body: text }).select(SALE_MEMO_COLUMNS).single();
  if (error || !data) return { ok: false, error: friendly(error?.message ?? "메모를 저장하지 못했습니다.") };
  refresh();
  return { ok: true, memo: data as SaleMemo };
}

/** 본인이 쓴 메모만 지워진다(RLS) — 남의 메모·권한 없음은 0건이라 그대로 알린다. */
export async function deleteSaleMemo(memoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_RE.test(memoId)) return { ok: false, error: "잘못된 메모입니다." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("sale_memo").delete().eq("id", memoId).select("id");
  if (error) return { ok: false, error: friendly(error.message) };
  if (!data || data.length === 0) return { ok: false, error: "지울 수 없습니다 — 본인이 쓴 메모만 지울 수 있습니다." };
  refresh();
  return { ok: true };
}
