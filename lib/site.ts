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
