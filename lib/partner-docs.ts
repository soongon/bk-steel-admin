import "server-only";

import { type SupabaseClient } from "@supabase/supabase-js";
import { PARTNER_DOC_KINDS, PARTNER_DOC_MAX, type OwnCompany, type PartnerDocKind, type PartnerDocView } from "@/lib/biz-doc";

/**
 * 거래처 사업자 이미지 저장소 — 비공개 버킷 'partner-docs' + partner_document 행(0088). 서버 액션 전용.
 * 화면에는 서명 URL(1시간)로만 보여 준다. 권한은 RLS 가 강제한다(보기 = 로그인, 올리기·빼기 = owner/manager).
 */

const BUCKET = "partner-docs";
const SIGNED_SECONDS = 60 * 60; // 다이얼로그를 오래 열어 둬도 이미지가 보이게
const MAX_BYTES = 5 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const asPartnerDocKind = (v: unknown): PartnerDocKind =>
  PARTNER_DOC_KINDS.includes(v as PartnerDocKind) ? (v as PartnerDocKind) : "other";

/** 올릴 수 있는 이미지인가 — 아니면 이유. */
export function partnerDocFileError(file: File): string | null {
  if (file.size === 0) return "빈 파일입니다.";
  if (file.size > MAX_BYTES) return "이미지가 5MB를 넘습니다.";
  if (!MIME_EXT[file.type]) return "사진 파일(JPEG·PNG·WebP)만 올릴 수 있습니다.";
  return null;
}

/** 거래처 마스터를 고칠 수 있는가 — 어느 책이든 owner/manager(RLS p_master_write_check 와 같은 함수). */
export async function canWriteMasters(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc("current_user_is_owner_or_manager_any_book");
  return !error && data === true;
}

/** 우리 회사 사업자(책별 회사 정보) — 서류에서 거래처 쪽을 고를 때 뺀다. */
export async function fetchOwnCompanies(sb: SupabaseClient): Promise<OwnCompany[]> {
  const { data } = await sb.from("company_profile").select("business_no, name");
  return (data ?? []) as OwnCompany[];
}

/** 이 거래처의 이미지 — 정렬 순서대로, 서명 URL 을 붙여서. 파일이 없어진 행은 뺀다. */
export async function listPartnerDocs(
  sb: SupabaseClient,
  partnerId: string,
): Promise<{ docs: PartnerDocView[]; error?: string }> {
  const { data, error } = await sb
    .from("partner_document")
    .select("id, kind, path, sort_order, created_at")
    .eq("partner_id", partnerId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return { docs: [], error: error.message };
  const rows = (data ?? []) as Array<{ id: string; kind: string; path: string; sort_order: number; created_at: string }>;
  if (rows.length === 0) return { docs: [] };
  const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), SIGNED_SECONDS);
  if (signErr) return { docs: [], error: signErr.message };
  const urlOf = new Map((signed ?? []).filter((s) => s.path && s.signedUrl && !s.error).map((s) => [s.path as string, s.signedUrl]));
  return {
    docs: rows.flatMap((r) => {
      const url = urlOf.get(r.path);
      return url ? [{ id: r.id, kind: asPartnerDocKind(r.kind), url, sort_order: r.sort_order, created_at: r.created_at }] : [];
    }),
  };
}

/** 지금 이미지 수와 다음 정렬 번호 — 상한(PARTNER_DOC_MAX) 계산용. */
async function docSlots(sb: SupabaseClient, partnerId: string): Promise<{ count: number; nextSort: number } | null> {
  const { data, error } = await sb.from("partner_document").select("sort_order").eq("partner_id", partnerId);
  if (error) return null;
  const rows = (data ?? []) as Array<{ sort_order: number }>;
  return { count: rows.length, nextSort: rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1 };
}

async function storeOne(sb: SupabaseClient, partnerId: string, file: File, kind: PartnerDocKind, sortOrder: number): Promise<boolean> {
  const path = `${partnerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${MIME_EXT[file.type] ?? "jpg"}`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return false;
  const { error } = await sb
    .from("partner_document")
    .insert({ partner_id: partnerId, kind, path, mime: file.type, bytes: file.size, sort_order: sortOrder });
  if (error) {
    await sb.storage.from(BUCKET).remove([path]).catch(() => undefined); // 행이 안 들어갔으면 파일도 지운다
    return false;
  }
  return true;
}

/**
 * 새 이미지 올리기 — 상한 안에서 고른 순서대로(sort_order 지정), 서버에서 동시에. 못 올린 장 수를 돌려준다
 * (상한을 넘어 버린 장 포함). 입력 검증(partnerDocFileError)과 권한 확인은 호출측.
 */
export async function addPartnerDocs(
  sb: SupabaseClient,
  partnerId: string,
  docs: Array<{ file: File; kind: PartnerDocKind }>,
): Promise<number> {
  if (docs.length === 0) return 0;
  const slots = await docSlots(sb, partnerId);
  if (!slots) return docs.length;
  const room = Math.max(0, PARTNER_DOC_MAX - slots.count);
  const results = await Promise.all(
    docs.slice(0, room).map((d, i) => storeOne(sb, partnerId, d.file, d.kind, slots.nextSort + i).catch(() => false)),
  );
  return results.filter((ok) => !ok).length + Math.max(0, docs.length - room);
}

/** 이미지 빼기 — 이 거래처의 행만 지우고 파일은 뒤따라 지운다(best-effort). 못 뺀 장 수를 돌려준다. */
export async function removePartnerDocs(sb: SupabaseClient, partnerId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await sb
    .from("partner_document")
    .delete()
    .in("id", ids)
    .eq("partner_id", partnerId)
    .select("path");
  if (error) return ids.length;
  const paths = ((data ?? []) as Array<{ path: string }>).map((r) => r.path);
  if (paths.length > 0) await sb.storage.from(BUCKET).remove(paths).catch(() => undefined);
  return 0;
}
