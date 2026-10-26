"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isValidBook } from "@/lib/book";
import { collectBothDirections, type CollectResult } from "@/lib/hometax/collect";
import type { HometaxDateType } from "@/lib/hometax/types";

export type CollectNowResult =
  | { ok: true; sell: CollectResult; buy: CollectResult }
  | { ok: false; error: string };

/**
 * [지금 수집] — 로그인 사용자 권한(RLS staff)으로 팝빌에 수집을 요청하고 저장한다.
 * 매출·매입을 차례로 돌리며, 한쪽이 실패해도 다른 쪽 결과는 돌려준다.
 */
export async function collectNow(formData: FormData): Promise<CollectNowResult> {
  const str = (k: string) => (formData.get(k) as string | null)?.trim() ?? "";
  const book = str("book");
  if (!isValidBook(book) || book === "b") return { ok: false, error: "법인 또는 사업자 책을 선택해 주세요." };
  const dateType = (str("date_type") || "S").toUpperCase();
  if (!["W", "I", "S"].includes(dateType)) return { ok: false, error: "기준일 유형이 올바르지 않습니다." };
  const from = str("from");
  const to = str("to");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, error: "기간을 입력해 주세요." };
  if (from > to) return { ok: false, error: "시작일이 종료일보다 늦습니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const r = await collectBothDirections(supabase, {
    book,
    dateType: dateType as HometaxDateType,
    from,
    to,
    source: "manual",
    requestedBy: user.id,
  });
  revalidatePath(`/${book}/hometax`);
  revalidatePath(`/all/hometax`);
  return { ok: true, sell: r.sell, buy: r.buy };
}
