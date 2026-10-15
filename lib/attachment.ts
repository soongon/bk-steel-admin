"use server";

import { createClient } from "@/lib/supabase/server";

export type Attachment = {
  id: string;
  entity_type: string;
  entity_id: string;
  kind: string | null;
  storage: string;
  path: string | null;
  url: string;
  thumbnail_url: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  sort_order: number;
  created_at: string;
};

export type AttachmentEntityType =
  | "business_card"
  | "sales_log"
  | "sale"
  | "purchase"
  | "receipt"
  | "purchase_quote"; // 매입견적서 판매자 명함(0077)

export type AttachmentResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; error: string };

export type AttachmentListResult =
  | { ok: true; attachments: Attachment[] }
  | { ok: false; error: string };

const BUCKET = "attachments";
const MAX_BYTES = 5 * 1024 * 1024;

function friendly(message: string): string {
  if (message.includes("row-level security")) return "권한이 없습니다.";
  if (message.includes("Payload too large")) return "파일이 5MB를 초과했습니다.";
  if (message.includes("mime type")) return "지원하지 않는 형식입니다 (png/jpeg/webp).";
  return message;
}

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : null);

/** 파일 1개를 버킷에 올리고 attachment row INSERT — INSERT 가 실패하면 올린 파일을 지운다. 입력 검증은 호출측. */
async function storeOne(
  supabase: ServerSupabase,
  file: File,
  meta: { entityType: string; entityId: string; kind: string | null; caption: string | null; sortOrder: number; userId: string | null },
): Promise<AttachmentResult> {
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${meta.entityType}/${meta.entityId}/${Date.now()}-${rand}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
  if (upErr) return { ok: false, error: friendly(upErr.message) };

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const { data, error } = await supabase
    .from("attachment")
    .insert({
      entity_type: meta.entityType,
      entity_id: meta.entityId,
      kind: meta.kind,
      storage: "supabase",
      path,
      url: pub.publicUrl,
      mime: file.type || null,
      bytes: file.size,
      caption: meta.caption,
      sort_order: meta.sortOrder,
      created_by: meta.userId,
    })
    .select()
    .single();

  if (error) {
    // DB insert 실패 시 업로드된 파일 정리
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, error: friendly(error.message) };
  }

  return { ok: true, attachment: data as Attachment };
}

/**
 * 파일을 Supabase Storage 'attachments' 버킷에 업로드 후 attachment row INSERT.
 * formData 필수: file, entity_type, entity_id; 선택: kind, caption.
 */
export async function uploadAttachment(formData: FormData): Promise<AttachmentResult> {
  const file = formData.get("file");
  const entityType = formData.get("entity_type");
  const entityId = formData.get("entity_id");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일이 비어있습니다." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "파일이 5MB를 초과했습니다." };
  }
  if (typeof entityType !== "string" || typeof entityId !== "string") {
    return { ok: false, error: "entity_type / entity_id 필수." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return storeOne(supabase, file, {
    entityType,
    entityId,
    kind: text(formData.get("kind")),
    caption: text(formData.get("caption")),
    sortOrder: 0,
    userId: user?.id ?? null,
  });
}

export type AttachmentSyncResult = { ok: true; failed: number } | { ok: false; error: string };

/**
 * 한 엔티티의 첨부를 한 번에 반영 — 빼기(soft delete + 파일 삭제)와 올리기를 서버에서 동시에 처리한다.
 * 클라이언트는 서버 액션을 하나씩 차례로 보내므로(Next 16), 파일마다 액션을 부르면 업로드가 줄을 선다.
 * formData 필수: entity_type, entity_id; 선택: kind, file(여러 개), remove_id(여러 개), sort_base(새 파일 sort_order 시작값).
 * 빼기는 이 엔티티에 붙은 행만(다른 엔티티 첨부는 못 지운다). failed = 반영하지 못한 건수.
 */
export async function syncAttachments(formData: FormData): Promise<AttachmentSyncResult> {
  const entityType = formData.get("entity_type");
  const entityId = formData.get("entity_id");
  if (typeof entityType !== "string" || typeof entityId !== "string") {
    return { ok: false, error: "entity_type / entity_id 필수." };
  }
  const kind = text(formData.get("kind"));
  const sortBase = Math.trunc(Number(formData.get("sort_base")) || 0);
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const removeIds = formData.getAll("remove_id").filter((v): v is string => typeof v === "string" && v !== "");
  if (files.some((f) => f.size > MAX_BYTES)) return { ok: false, error: "파일이 5MB를 초과했습니다." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let removing: Array<{ id: string; path: string | null; storage: string }> = [];
  if (removeIds.length > 0) {
    const { data, error } = await supabase
      .from("attachment")
      .select("id, path, storage")
      .in("id", removeIds)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .is("deleted_at", null);
    if (error) return { ok: false, error: friendly(error.message) };
    removing = data ?? [];
  }

  async function removeAll(): Promise<number> {
    if (removing.length === 0) return 0; // 이미 없는 행은 목적 달성으로 본다
    const { error } = await supabase
      .from("attachment")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", removing.map((r) => r.id));
    if (error) return removing.length;
    const paths = removing.filter((r) => r.storage === "supabase" && r.path).map((r) => r.path as string);
    if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths); // best-effort(행은 이미 soft delete)
    return 0;
  }

  const [removeFailed, uploads] = await Promise.all([
    removeAll().catch(() => removing.length),
    Promise.all(
      files.map((file, i) =>
        storeOne(supabase, file, {
          entityType,
          entityId,
          kind,
          caption: null,
          sortOrder: sortBase + i,
          userId: user?.id ?? null,
        }).catch((): AttachmentResult => ({ ok: false, error: "업로드 실패" })),
      ),
    ),
  ]);
  return { ok: true, failed: removeFailed + uploads.filter((r) => !r.ok).length };
}

export async function listAttachments(
  entityType: AttachmentEntityType,
  entityId: string,
  kind?: string,
): Promise<AttachmentListResult> {
  const supabase = await createClient();
  let q = supabase
    .from("attachment")
    .select(
      "id, entity_type, entity_id, kind, storage, path, url, thumbnail_url, mime, bytes, width, height, caption, sort_order, created_at",
    )
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (kind) q = q.eq("kind", kind);

  const { data, error } = await q;
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true, attachments: (data ?? []) as Attachment[] };
}

export async function deleteAttachment(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();

  // path를 먼저 읽어서 Storage 파일도 같이 정리
  const { data: row } = await supabase
    .from("attachment")
    .select("path, storage")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("attachment")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };

  if (row?.storage === "supabase" && row.path) {
    // Storage 파일 best-effort 삭제 (실패해도 row는 이미 soft delete됨)
    await supabase.storage.from(BUCKET).remove([row.path]);
  }

  return { ok: true };
}

export async function updateAttachmentCaption(
  id: string,
  caption: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("attachment")
    .update({ caption: caption?.trim() || null })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true };
}
