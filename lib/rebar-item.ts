import { type SupabaseClient } from "@supabase/supabase-js";
import { parseCustomRebarItemId } from "@/lib/rebar";

/**
 * 길이 직접 입력 라인의 임시 품목 id('rebar:D13:SD400:6.5')를 실제 품목 id 로 바꾼다 — 없으면 만든다(ensure_rebar_item, 0103).
 * 거래처·현장 자동 생성(resolvePartnerId·resolveSiteId)과 같은 취지. 임시 id 가 없는 라인은 그대로 돌려준다.
 */
export async function resolveCustomRebarItems<T extends { item_id: string }>(
  supabase: SupabaseClient,
  lines: T[],
): Promise<{ lines: T[] } | { error: string }> {
  const resolved = new Map<string, string>();
  for (const l of lines) {
    if (resolved.has(l.item_id)) continue;
    const p = parseCustomRebarItemId(l.item_id);
    if (!p) {
      if (l.item_id.startsWith("rebar:")) return { error: "철근 규격·길이를 확인해주세요." };
      continue;
    }
    const { data, error } = await supabase.rpc("ensure_rebar_item", {
      p_spec: p.spec,
      p_grade: p.grade,
      p_length_m: p.lengthM,
    });
    if (error || !data) {
      return { error: `철근 품목(${p.spec} ${p.grade} ${p.lengthM}M)을 만들지 못했습니다${error ? `: ${error.message}` : ""}` };
    }
    resolved.set(l.item_id, String(data));
  }
  if (resolved.size === 0) return { lines };
  return { lines: lines.map((l) => (resolved.has(l.item_id) ? { ...l, item_id: resolved.get(l.item_id)! } : l)) };
}
