"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { digitsOnly } from "@/lib/format";
import { kstToday } from "@/lib/radar/radar-data";
import {
  DISMISS_REASONS,
  PERMANENT_DISMISS_REASON,
  RESULT_CODE_VALUES,
  RESULT_REFUSED,
  addDays,
  extractRadarId,
  normalizeResultCode,
  resultCodeOf,
  type DismissReason,
} from "@/lib/radar/v2-rules";

export type RadarActionResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOTHING_CHANGED = "이미 처리됐거나 권한이 없습니다. 새로고침 후 다시 확인하세요.";

function str(formData: FormData, k: string, max = 500): string | null {
  const v = formData.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t === "" ? null : t;
}

function friendlyError(message: string): string {
  if (message.includes("row-level security")) return "권한이 없습니다.";
  if (message.includes("permanently dismissed")) return "'철근 안 씀·거절'로 제외된 대상이라 기록할 수 없습니다(수신거부 보장).";
  if (message.includes("already dismissed")) return "이미 제외된 대상입니다. 새로고침 후 확인하세요.";
  if (message.includes("invalid result code")) return "결과 코드가 올바르지 않습니다.";
  if (message.includes("not found")) return "행을 찾지 못했습니다(삭제됐거나 권한이 없음).";
  if (message.includes("invalid input syntax for type date")) return "날짜 형식이 올바르지 않습니다.";
  return message;
}

function bump() {
  revalidatePath("/radar");
  for (const book of ["all", "bk", "sl", "b"]) revalidatePath(`/${book}/sales-log`);
}

/**
 * [기록] — RPC radar_touch: sales_log INSERT + (거절·현장없음이면) 제외 UPDATE 한 트랜잭션.
 * 결과 코드 4종 고정. 제외 코드가 아니면 다음 행동일이 비어도 접촉일 + 7일(기한 없는 '대기' 방지).
 * 전화는 숫자만 저장(레포 관례: 저장 digits, 표시 formatPhone).
 */
export async function recordRadarTouch(formData: FormData): Promise<RadarActionResult> {
  const projectId = str(formData, "project_id");
  const result = str(formData, "result");
  const channel = str(formData, "channel") ?? "visit";
  if (!projectId || !UUID_RE.test(projectId)) return { ok: false, error: "대상 행이 올바르지 않습니다." };
  if (!result || !RESULT_CODE_VALUES.includes(result)) return { ok: false, error: "결과를 선택하세요." };
  if (channel !== "phone" && channel !== "visit") return { ok: false, error: "채널이 올바르지 않습니다." };
  const code = resultCodeOf(result)!;

  const contactedOn = str(formData, "contacted_on") ?? kstToday();
  if (!DATE_RE.test(contactedOn)) return { ok: false, error: "접촉일 형식이 올바르지 않습니다." };
  let followUp: string | null = null;
  if (code.followUpDays != null) {
    followUp = str(formData, "follow_up_on") ?? addDays(contactedOn, code.followUpDays);
    if (!DATE_RE.test(followUp)) return { ok: false, error: "다음 행동일 형식이 올바르지 않습니다." };
    if (followUp < contactedOn) return { ok: false, error: "다음 행동일은 접촉일 이후여야 합니다." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("radar_touch", {
    p_project_id: projectId,
    p_channel: channel,
    p_result: result,
    p_contact_person: str(formData, "contact_person", 100),
    p_contact_phone: digitsOnly(str(formData, "contact_phone", 40)) || null,
    p_company: str(formData, "company", 100),
    p_notes: str(formData, "notes", 1000),
    p_follow_up_on: followUp,
    p_contacted_on: contactedOn,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  bump();
  return { ok: true };
}

/** [제외] — 사유 3종. 낙찰사(awardee_bizno)가 있는 행은 계정 전체. 완료 탭에서 복구 가능('철근 안 씀·거절' 제외). */
export async function dismissRadarProject(id: string, reason: string): Promise<RadarActionResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "대상 행이 올바르지 않습니다." };
  if (!(DISMISS_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "제외 사유를 선택하세요." };
  const supabase = await createClient();
  const { data: row, error: e1 } = await supabase
    .from("construction_project")
    .select("id, awardee_bizno")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (e1) return { ok: false, error: friendlyError(e1.message) };
  if (!row) return { ok: false, error: "행을 찾지 못했습니다." };

  const patch = { dismissed_at: new Date().toISOString(), dismiss_reason: reason as DismissReason };
  // 이미 제외된 행은 건드리지 않는다(영구 제외가 복구 가능 사유로 강등되지 않게). 단 '철근 안 씀·거절'은
  // 복구 가능 사유로 제외된 행도 영구로 승격한다. 0행 갱신 = 실패로 본다(RLS·경합).
  let q = supabase.from("construction_project").update(patch);
  q = row.awardee_bizno ? q.eq("awardee_bizno", row.awardee_bizno) : q.eq("id", id);
  q =
    reason === PERMANENT_DISMISS_REASON
      ? q.or(`dismissed_at.is.null,dismiss_reason.is.null,dismiss_reason.neq."${PERMANENT_DISMISS_REASON}"`)
      : q.is("dismissed_at", null);
  const { data: changed, error } = await q.select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!changed || changed.length === 0) return { ok: false, error: NOTHING_CHANGED };
  bump();
  return { ok: true };
}

/** [복구] — '철근 안 씀·거절'(수신거부 보장)은 복구 불가. */
export async function restoreRadarProject(id: string): Promise<RadarActionResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "대상 행이 올바르지 않습니다." };
  const supabase = await createClient();
  const { data: row, error: e1 } = await supabase
    .from("construction_project")
    .select("id, awardee_bizno, dismiss_reason")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (e1) return { ok: false, error: friendlyError(e1.message) };
  if (!row) return { ok: false, error: "행을 찾지 못했습니다." };
  if (row.dismiss_reason === PERMANENT_DISMISS_REASON) {
    return { ok: false, error: "'철근 안 씀·거절'은 수신거부 보장을 위해 복구할 수 없습니다." };
  }
  // 영업내역에 '거절'이 남은 행·계정도 복구 불가 — 연결된 기록 + 메모 "레이더 {id}"만 있는 미연결 수기 기록
  let ids = [id];
  if (row.awardee_bizno) {
    const { data: acc, error: e2 } = await supabase.from("construction_project").select("id").eq("awardee_bizno", row.awardee_bizno);
    if (e2) return { ok: false, error: friendlyError(e2.message) };
    ids = (acc ?? []).map((r) => r.id as string);
  }
  const [linked, noted] = await Promise.all([
    supabase.from("sales_log").select("result").in("project_id", ids).is("deleted_at", null),
    supabase.from("sales_log").select("result, notes").is("project_id", null).is("deleted_at", null).ilike("notes", "%레이더%"),
  ]);
  if (linked.error || noted.error) return { ok: false, error: friendlyError((linked.error ?? noted.error)!.message) };
  const idSet = new Set(ids);
  const refused =
    (linked.data ?? []).some((l) => normalizeResultCode(l.result as string | null) === RESULT_REFUSED) ||
    (noted.data ?? []).some(
      (l) => idSet.has(extractRadarId(l.notes as string | null) ?? "") && normalizeResultCode(l.result as string | null) === RESULT_REFUSED,
    );
  if (refused) return { ok: false, error: "영업내역에 '거절' 기록이 있어 복구할 수 없습니다(수신거부 보장)." };

  const patch = { dismissed_at: null, dismiss_reason: null };
  // 계정 단위는 soft delete 행까지 — 제외(radar_touch·[제외]·기록 연결)가 삭제 행도 표시하고 숨김 판정도 삭제 무관이라 범위를 맞춘다.
  // NULL 사유 제외 행도 복구 대상(.neq 는 NULL 을 빼므로 or 로)
  let q = supabase.from("construction_project").update(patch);
  q = row.awardee_bizno ? q.eq("awardee_bizno", row.awardee_bizno) : q.eq("id", id);
  q = q.not("dismissed_at", "is", null).or(`dismiss_reason.is.null,dismiss_reason.neq."${PERMANENT_DISMISS_REASON}"`);
  const { data: changed, error } = await q.select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!changed || changed.length === 0) return { ok: false, error: NOTHING_CHANGED };
  bump();
  return { ok: true };
}
