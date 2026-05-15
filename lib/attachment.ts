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
  | "receipt";

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

/**
 * 파일을 Supabase Storage 'attachments' 버킷에 업로드 후 attachment row INSERT.
 * formData 필수: file, entity_type, entity_id; 선택: kind, caption.
 */
export async function uploadAttachment(formData: FormData): Promise<AttachmentResult> {
  const file = formData.get("file");
  const entityType = formData.get("entity_type");
  const entityId = formData.get("entity_id");
  const kind = formData.get("kind");
  const caption = formData.get("caption");

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

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${entityType}/${entityId}/${Date.now()}-${rand}.${ext}`;

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
      entity_type: entityType,
      entity_id: entityId,
      kind: typeof kind === "string" && kind.trim() !== "" ? kind : null,
      storage: "supabase",
      path,
      url: pub.publicUrl,
      mime: file.type || null,
      bytes: file.size,
      caption: typeof caption === "string" && caption.trim() !== "" ? caption : null,
      created_by: user?.id ?? null,
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
