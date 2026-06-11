import { type SupabaseClient } from "@supabase/supabase-js";

export type Site = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  client_name: string | null;       // 시공사
  owner_name: string | null;        // 건축주 (관급은 사업명)
  owner_address: string | null;     // 건축주·발주청 주소
  status: "active" | "closed";
  started_on: string | null;
  ended_on: string | null;
  notes: string | null;
  is_active: boolean;
};

export async function fetchActiveSites(supabase: SupabaseClient): Promise<Site[]> {
  const { data } = await supabase
    .from("site")
    .select(
      "id, code, name, address, city, client_name, owner_name, owner_address, status, started_on, ended_on, notes, is_active",
    )
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Site[];
}

export async function fetchAllSites(supabase: SupabaseClient): Promise<Site[]> {
  const { data } = await supabase
    .from("site")
    .select(
      "id, code, name, address, city, client_name, owner_name, owner_address, status, started_on, ended_on, notes, is_active",
    )
    .is("deleted_at", null)
    .order("name");
  return (data ?? []) as Site[];
}

/**
 * site_id 가 없고 site_name 만 있는 경우(미등록 현장) site 마스터 자동 생성.
 * UNIQUE(name) 충돌 시 기존 row 조회로 fallback. 매출·매입 등록/편집 공용.
 */
export async function resolveSiteId(
  supabase: SupabaseClient,
  siteId: string | null,
  siteName: string | null,
): Promise<string | null> {
  if (siteId) return siteId;
  if (!siteName) return null;
  const trimmed = siteName.trim();
  if (!trimmed) return null;

  const { data: created } = await supabase
    .from("site")
    .insert({ name: trimmed })
    .select("id")
    .maybeSingle();
  if (created) return created.id;

  // UNIQUE 충돌 등 → 기존 row 조회
  const { data: existing } = await supabase
    .from("site")
    .select("id")
    .eq("name", trimmed)
    .is("deleted_at", null)
    .maybeSingle();
  return existing?.id ?? null;
}
