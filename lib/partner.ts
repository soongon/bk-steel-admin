import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * partner_id 가 없고 partner_name 만 있는 경우(미등록 거래처) partner 마스터 자동 생성/조회.
 * resolveSiteId(lib/site)와 동일 취지이되, partner.name 에는 UNIQUE 가 없으므로
 * 같은 이름 기존 거래처를 먼저 조회해 중복 생성을 방지하고, 없을 때만 insert.
 * code 는 0004_masters_shared 의 DEFAULT('P-'||seq)로 자동 부여.
 */
export async function resolvePartnerId(
  supabase: SupabaseClient,
  partnerId: string | null,
  partnerName: string | null,
): Promise<string | null> {
  if (partnerId) return partnerId;
  const trimmed = partnerName?.trim();
  if (!trimmed) return null;

  const { data: existing } = await supabase
    .from("partner")
    .select("id")
    .eq("name", trimmed)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created } = await supabase
    .from("partner")
    .insert({ name: trimmed })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
}
