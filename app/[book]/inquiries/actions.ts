"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { digitsOnly } from "@/lib/format";
import { type InquirySource, isInquiryStatus, isInquiryType } from "@/lib/inquiry";
import { isLeadSource } from "@/lib/lead-source";
import { insertPhoneInquiry, removeInquiry, writeInquiryStatus } from "@/lib/homepage-inquiry";

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

/** 문의 삭제(목록 휴지통) — 홈페이지 DB 에서 실제로 지운다. */
export async function deleteInquiry(id: string): Promise<InquiryActionResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "잘못된 문의입니다." };
  const r = await removeInquiry(id);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.data.deleted) return { ok: false, error: "문의를 찾지 못했습니다. 이미 지워졌을 수 있습니다." };
  // 어드민 DB 의 메모 기록(0098, FK 없음)도 같이 — 실패해도 문의는 이미 지워졌으니 알리기만 한다(남은 메모는 보이는 곳이 없다).
  const supabase = await createClient();
  const { error: purgeError } = await supabase.rpc("purge_inquiry_memos", { p_inquiry_id: id });
  if (purgeError) console.warn("purge_inquiry_memos failed:", purgeError.message);
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

const PHONE_RE = /^\d{9,12}$/; // 홈페이지 폼과 같은 규칙
const KST_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/; // <input type="datetime-local"> 값(한국 시각)

const text = (fd: FormData, key: string, max: number) => String(fd.get(key) ?? "").trim().slice(0, max);

/** 전화 문의 직접 입력 — 저장되면 새 문의 id(상세로 이동). */
export async function createPhoneInquiry(fd: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const inquiryType = fd.get("inquiry_type");
  if (!isInquiryType(inquiryType)) return { ok: false, error: "매입·납품 중 구분을 골라 주세요." };
  const name = text(fd, "name", 100);
  if (!name) return { ok: false, error: "이름(업체명)을 입력해 주세요." };
  const phone = digitsOnly(String(fd.get("phone") ?? ""));
  if (!PHONE_RE.test(phone)) return { ok: false, error: "전화번호를 확인해 주세요 (숫자 9~12자리)." };
  const status = fd.get("status");
  if (!isInquiryStatus(status)) return { ok: false, error: "잘못된 상태값입니다." };

  // 접수 시각 — 비우면 지금. 나중에 몰아 적는 경우를 위해 받은 시각을 고를 수 있다(미래는 안 됨).
  const at = String(fd.get("received_at") ?? "").trim();
  let createdAt = new Date();
  if (at) {
    if (!KST_DATETIME_RE.test(at)) return { ok: false, error: "접수 시각 형식이 잘못되었습니다." };
    createdAt = new Date(`${at}:00+09:00`);
    if (Number.isNaN(createdAt.getTime())) return { ok: false, error: "접수 시각 형식이 잘못되었습니다." };
    if (createdAt.getTime() > Date.now() + 5 * 60_000) return { ok: false, error: "접수 시각이 미래입니다." };
  }

  const source: InquirySource = { channel: "phone" };
  const lead = fd.get("lead_source");
  if (isLeadSource(lead)) source.lead_source = lead;
  const leadNote = text(fd, "lead_note", 200);
  if (source.lead_source && leadNote) source.lead_note = leadNote;

  const r = await insertPhoneInquiry({
    inquiry_type: inquiryType,
    name,
    phone,
    location: text(fd, "location", 200),
    message: text(fd, "message", 2000),
    status,
    created_at: createdAt.toISOString(),
    source,
  });
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, id: r.data.id };
}
