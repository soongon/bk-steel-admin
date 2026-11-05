import "server-only";

import { type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  TRADE_DOC_MAX,
  type TradeDocKind,
  type TradeDocParent,
  type TradeDocSyncResult,
  type TradeDocView,
  isTradeDocKind,
  isTradeDocKindOf,
} from "@/lib/trade-doc";

/**
 * 매출·매입·문의 사진 저장소 — 비공개 버킷 'trade-docs' + sale_document·purchase_document(0099)·inquiry_document(0100) 행. 서버 액션 전용.
 * 메모 기록(lib/memo-log-server.ts)처럼 붙이는 곳을 표로 고른다. 권한은 RLS 가 강제한다
 * (거래: 보기 = 거래가 보이면, 올리기 = 그 책 staff 이상, 빼기 = 올린 본인 · 문의: 어느 책이든 역할/staff). 화면에는 서명 URL(1시간)로만 보여 준다.
 * 문의 원본은 홈페이지 DB(parentTable null) — 있는지는 호출하는 서버 액션이 먼저 확인한다.
 */

const TABLES: Record<TradeDocParent, { table: string; fk: string; parentTable: "sale" | "purchase" | null; label: string; labelObj: string }> = {
  sale: { table: "sale_document", fk: "sale_id", parentTable: "sale", label: "매출", labelObj: "매출을" },
  purchase: { table: "purchase_document", fk: "purchase_id", parentTable: "purchase", label: "매입", labelObj: "매입을" },
  inquiry: { table: "inquiry_document", fk: "inquiry_id", parentTable: null, label: "문의", labelObj: "문의를" },
};
export type { TradeDocParent };

const BUCKET = "trade-docs";
const SIGNED_SECONDS = 60 * 60;
const MAX_BYTES = 5 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, kind, path, sort_order, created_at, created_by";

type Row = { id: string; kind: string; path: string; sort_order: number; created_at: string; created_by: string | null };
type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/** 올릴 수 있는 이미지인가 — 아니면 이유. */
function fileError(file: File): string | null {
  if (file.size === 0) return "빈 파일입니다.";
  if (file.size > MAX_BYTES) return "사진이 5MB를 넘습니다.";
  if (!MIME_EXT[file.type]) return "사진 파일(JPEG·PNG·WebP)만 올릴 수 있습니다.";
  return null;
}

/** 행 목록에 서명 URL 을 붙인다 — 파일이 없어진 행은 뺀다. 서명 자체가 실패하면 null(빈 목록으로 꾸미지 않는다). */
async function withUrls(sb: SupabaseClient, rows: Row[]): Promise<TradeDocView[] | null> {
  if (rows.length === 0) return [];
  const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), SIGNED_SECONDS);
  if (error) return null;
  const urlOf = new Map((signed ?? []).filter((s) => s.path && s.signedUrl && !s.error).map((s) => [s.path as string, s.signedUrl]));
  return rows.flatMap((r) => {
    const url = urlOf.get(r.path);
    return url && isTradeDocKind(r.kind)
      ? [{ id: r.id, kind: r.kind, url, sort_order: r.sort_order, created_at: r.created_at, created_by: r.created_by }]
      : [];
  });
}

/**
 * 이 거래의 사진 — 정렬 순서대로, 서명 URL 을 붙여서. 상세 페이지(서버)와 저장 뒤 다시 읽기 공용.
 * null = 읽기·서명 실패(빈 목록과 구분 — 빈 목록으로 보이면 같은 사진을 또 올리게 된다).
 */
export async function listTradeDocs(sb: SupabaseClient, parent: TradeDocParent, parentId: string): Promise<TradeDocView[] | null> {
  const { table, fk } = TABLES[parent];
  const { data, error } = await sb
    .from(table)
    .select(COLUMNS)
    .eq(fk, parentId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return null;
  return withUrls(sb, (data ?? []) as Row[]);
}

async function storeOne(
  sb: ServerSupabase,
  parent: TradeDocParent,
  parentId: string,
  file: File,
  kind: TradeDocKind,
  sortOrder: number,
): Promise<boolean> {
  const { table, fk } = TABLES[parent];
  const path = `${parent}/${parentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${MIME_EXT[file.type] ?? "jpg"}`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return false;
  const { error } = await sb.from(table).insert({ [fk]: parentId, kind, path, mime: file.type, bytes: file.size, sort_order: sortOrder });
  if (error) {
    await sb.storage.from(BUCKET).remove([path]).catch(() => undefined); // 행이 안 들어갔으면 파일도 지운다
    return false;
  }
  return true;
}

/**
 * 사진 올리기·빼기를 한 번에(서버 액션 하나로 — 클라이언트는 액션을 차례로 보내므로 장마다 부르면 줄을 선다).
 * formData: file(여러 개) + 같은 순서의 kind(여러 개), remove_id(여러 개). 상한(TRADE_DOC_MAX)을 넘는 장은 올리지 않는다.
 * 돌려주는 docs = 반영 뒤 전체 목록(서명 URL 포함, 다시 읽지 못하면 null), failed = 반영하지 못한 장 수.
 */
export async function syncTradeDocs(parent: TradeDocParent, parentId: string, fd: FormData): Promise<TradeDocSyncResult> {
  const { table, fk, parentTable, label, labelObj } = TABLES[parent];
  if (!UUID_RE.test(parentId)) return { ok: false, error: `잘못된 ${label}입니다.` };

  const files = fd.getAll("file").filter((f): f is File => f instanceof File);
  const kinds = fd.getAll("kind");
  const removeIds = fd.getAll("remove_id").filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
  if (files.length !== kinds.length || kinds.some((k) => !isTradeDocKindOf(parent, k))) return { ok: false, error: "사진 종류를 골라 주세요." };
  for (const f of files) {
    const err = fileError(f);
    if (err) return { ok: false, error: err };
  }

  const sb = await createClient();
  if (parentTable) {
    const { data: parentRow } = await sb.from(parentTable).select("id").eq("id", parentId).is("deleted_at", null).maybeSingle();
    if (!parentRow) return { ok: false, error: `${labelObj} 찾을 수 없습니다(취소·삭제됐을 수 있음). 새로고침해 주세요.` };
  }

  let failed = 0;

  // 빼기 — 이 거래의 행만, 본인 것만 지워진다(RLS). 못 지운 건 failed 로 센다.
  if (removeIds.length > 0) {
    const { data, error } = await sb.from(table).delete().in("id", removeIds).eq(fk, parentId).select("path");
    if (error) failed += removeIds.length;
    else {
      const paths = ((data ?? []) as Array<{ path: string }>).map((r) => r.path);
      failed += removeIds.length - paths.length;
      if (paths.length > 0) await sb.storage.from(BUCKET).remove(paths).catch(() => undefined); // best-effort(행은 이미 지움)
    }
  }

  // 올리기 — 상한 안에서, 서버에서 동시에.
  if (files.length > 0) {
    const { data: existing, error } = await sb.from(table).select("sort_order").eq(fk, parentId);
    if (error) failed += files.length;
    else {
      const rows = (existing ?? []) as Array<{ sort_order: number }>;
      const nextSort = rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
      const room = Math.max(0, TRADE_DOC_MAX - rows.length);
      const results = await Promise.all(
        files.slice(0, room).map((f, i) => storeOne(sb, parent, parentId, f, kinds[i] as TradeDocKind, nextSort + i).catch(() => false)),
      );
      failed += results.filter((ok) => !ok).length + Math.max(0, files.length - room);
    }
  }

  return { ok: true, docs: await listTradeDocs(sb, parent, parentId), failed };
}
