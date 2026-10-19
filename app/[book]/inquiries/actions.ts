"use server";

import { revalidatePath } from "next/cache";
import { isInquiryStatus } from "@/lib/inquiry";
import { writeInquiryStatus } from "@/lib/homepage-inquiry";

export type InquiryActionResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 메뉴의 새 문의 배지는 [book] 레이아웃이 그린다 — 레이아웃째 다시 그려야 숫자가 바로 바뀐다.
const refresh = () => revalidatePath("/[book]", "layout");

/** 상태 버튼(새 문의·확인·완료). */
export async function updateInquiryStatus(id: string, status: string): Promise<InquiryActionResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "잘못된 문의입니다." };
  if (!isInquiryStatus(status)) return { ok: false, error: "잘못된 상태값입니다." };
  const r = await writeInquiryStatus(id, status);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.data.changed) return { ok: false, error: "문의를 찾지 못했습니다. 새로고침해 주세요." };
  refresh();
  return { ok: true };
}

/** 이 문의로 견적서를 저장했을 때 — '새 문의'면 '확인'으로 바꾼다(이미 확인·완료면 그대로). */
export async function markInquiryHandled(id: string): Promise<InquiryActionResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "잘못된 문의입니다." };
  const r = await writeInquiryStatus(id, "read", "new");
  if (!r.ok) return { ok: false, error: r.error };
  if (r.data.changed) refresh();
  return { ok: true };
}
