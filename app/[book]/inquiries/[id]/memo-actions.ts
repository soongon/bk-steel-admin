"use server";

import { revalidatePath } from "next/cache";
import { insertMemo, removeMemo } from "@/lib/memo-log-server";
import { type MemoAddResult, type MemoDeleteResult } from "@/lib/memo-log";
import { getInquiry } from "@/lib/homepage-inquiry";

// 상세 화면만 다시 그린다 — 문의 메모는 목록·메뉴 배지와 무관.
const refresh = () => revalidatePath("/[book]/inquiries/[id]", "page");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function addInquiryMemo(inquiryId: string, body: string): Promise<MemoAddResult> {
  // 문의 원본은 홈페이지 DB(FK 없음) — 화면을 연 사이 지워진 문의에 메모가 쌓이지 않게 먼저 확인한다.
  if (!UUID_RE.test(inquiryId)) return { ok: false, error: "잘못된 문의입니다." };
  const inq = await getInquiry(inquiryId);
  if (!inq.ok) return { ok: false, error: inq.error };
  if (!inq.data) return { ok: false, error: "문의를 찾을 수 없습니다(삭제됐을 수 있음). 새로고침해 주세요." };
  const r = await insertMemo("inquiry", inquiryId, body);
  if (r.ok) refresh();
  return r;
}

export async function deleteInquiryMemo(memoId: string): Promise<MemoDeleteResult> {
  const r = await removeMemo("inquiry", memoId);
  if (r.ok) refresh();
  return r;
}
