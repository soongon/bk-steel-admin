"use server";

import { revalidatePath } from "next/cache";
import { syncTradeDocs } from "@/lib/trade-docs-server";
import { type TradeDocSyncResult } from "@/lib/trade-doc";
import { getInquiry, writeInquiryStatus } from "@/lib/homepage-inquiry";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 문의 사진 올리기·빼기(0100) — 문의 원본은 홈페이지 DB(FK 없음)라 화면을 연 사이 지워진 문의에 사진이 쌓이지 않게 먼저 확인한다.
 * 사진을 올리면 손을 댄 문의 — 메모처럼 '새 문의'면 '진행중'으로. 결과에 반영 뒤 목록이 오므로 상세는 다시 안 그린다.
 */
export async function syncInquiryDocs(inquiryId: string, fd: FormData): Promise<TradeDocSyncResult> {
  if (!UUID_RE.test(inquiryId)) return { ok: false, error: "잘못된 문의입니다." };
  const inq = await getInquiry(inquiryId);
  if (!inq.ok) return { ok: false, error: inq.error };
  if (!inq.data) return { ok: false, error: "문의를 찾을 수 없습니다(삭제됐을 수 있음). 새로고침해 주세요." };

  const r = await syncTradeDocs("inquiry", inquiryId, fd);
  // 실제로 한 장이라도 저장됐을 때만(전부 실패해도 ok:true 에 failed 만 센다)
  const sent = fd.getAll("file").length;
  if (r.ok && sent > 0 && r.failed < sent && inq.data.status === "new") {
    const s = await writeInquiryStatus(inquiryId, "read", "new");
    if (s.ok && s.data.changed) revalidatePath("/[book]", "layout"); // 목록 칩·메뉴 배지까지
  }
  return r;
}
