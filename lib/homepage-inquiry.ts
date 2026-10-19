import "server-only";
import { cache } from "react";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { type Inquiry, type InquiryStatus } from "@/lib/inquiry";

/**
 * 홈페이지 문의 읽기·상태 변경 — 홈페이지 전용 Supabase(어드민과 다른 프로젝트)를 서비스 롤로 연다.
 * env: HOMEPAGE_SUPABASE_URL · HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY. 없으면 화면은 '연결 설정 필요', 메뉴 배지는 없음.
 * 서비스 롤은 RLS 를 건너뛰므로 권한은 여기서 어드민 로그인·책 권한으로 직접 확인한다.
 * 홈페이지 쪽에는 status·updated_at 만 쓴다(책·거래 정보는 홈페이지로 보내지 않는다).
 */

export type InquiryResult<T> = { ok: true; data: T } | { ok: false; error: string; unconfigured?: boolean };

const COLUMNS = "id, inquiry_type, name, phone, location, message, status, created_at, updated_at, source, submit_count, notified_at";

export function homepageConfigured(): boolean {
  return !!process.env.HOMEPAGE_SUPABASE_URL && !!process.env.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY;
}

let db: SupabaseClient | null = null;
function homepageDb(): SupabaseClient {
  db ??= createSupabaseClient(process.env.HOMEPAGE_SUPABASE_URL!, process.env.HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return db;
}

/**
 * 어드민 로그인 + 책 권한(어느 책이든). 문의는 책과 무관한 공유 영역 — 보기는 viewer 이상, 상태 변경은 staff 이상
 * (current_user_has_book_role 의 staff = viewer 를 뺀 전부). 한 요청 안에서는 한 번만 묻는다.
 */
const checkAccess = cache(async (): Promise<{ ok: true; canWrite: boolean } | { ok: false; error: string }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const { data, error } = await supabase.from("user_book_role").select("role").eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  const roles = (data ?? []).map((r) => String(r.role));
  if (roles.length === 0) return { ok: false, error: "권한이 없습니다." };
  return { ok: true, canWrite: roles.some((r) => r !== "viewer") };
});

const UNCONFIGURED = {
  ok: false as const,
  unconfigured: true,
  error: "홈페이지 연결(HOMEPAGE_SUPABASE_URL · HOMEPAGE_SUPABASE_SERVICE_ROLE_KEY)이 설정되지 않았습니다.",
};

// 읽기는 권한 확인과 홈페이지 조회를 동시에 보내고(홈페이지 DB 가 멀어 순서대로면 느리다) 권한이 없으면 결과를 버린다.

/** 최근 문의(접수 최신순). 한 달 수십 건 규모라 상한만 둔다. */
export async function listInquiries(limit = 300): Promise<InquiryResult<Inquiry[]>> {
  if (!homepageConfigured()) return UNCONFIGURED;
  const [access, { data, error }] = await Promise.all([
    checkAccess(),
    homepageDb().from("inquiries").select(COLUMNS).order("created_at", { ascending: false }).limit(limit),
  ]);
  if (!access.ok) return access;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as Inquiry[] };
}

export async function getInquiry(id: string): Promise<InquiryResult<Inquiry | null>> {
  if (!homepageConfigured()) return UNCONFIGURED;
  const [access, { data, error }] = await Promise.all([
    checkAccess(),
    homepageDb().from("inquiries").select(COLUMNS).eq("id", id).maybeSingle(),
  ]);
  if (!access.ok) return access;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as Inquiry | null) ?? null };
}

/** 메뉴 배지용 새 문의 수 — 레이아웃이 기다리지 않고 넘기므로 절대 throw 하지 않는다(연결 없음·오류면 null). */
export async function countNewInquiries(): Promise<number | null> {
  try {
    if (!homepageConfigured()) return null;
    const [access, { count, error }] = await Promise.all([
      checkAccess(),
      homepageDb().from("inquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
    ]);
    if (!access.ok || error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/**
 * 상태 변경. onlyFrom 을 주면 지금 그 상태일 때만 바꾼다(견적 저장 → '새 문의'만 '확인'으로, 이미 완료면 그대로).
 * changed = 실제로 바뀐 행이 있었는지.
 */
export async function writeInquiryStatus(
  id: string,
  status: InquiryStatus,
  onlyFrom?: InquiryStatus,
): Promise<InquiryResult<{ changed: boolean }>> {
  if (!homepageConfigured()) return UNCONFIGURED;
  const access = await checkAccess();
  if (!access.ok) return access;
  if (!access.canWrite) return { ok: false, error: "권한이 없습니다 (staff 이상 필요)." };
  let q = homepageDb().from("inquiries").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (onlyFrom) q = q.eq("status", onlyFrom);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { changed: (data ?? []).length > 0 } };
}
