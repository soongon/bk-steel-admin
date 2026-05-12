import { createClient } from "@/lib/supabase/server";
import { ItemTable } from "./item-table";

export default async function ItemsPage() {
  const supabase = await createClient();
  const [itemsRes, specsRes, gradesRes] = await Promise.all([
    supabase
      .from("item")
      .select(
        "id, code, name, category, rebar_spec_code, rebar_grade_code, length_m, spec_text, weight_per_unit_kg, is_active",
      )
      .is("deleted_at", null)
      .order("category", { ascending: true })
      .order("code", { ascending: true }),
    supabase
      .from("rebar_spec")
      .select(
        "spec_code, nominal_diameter_mm, unit_weight_kg_per_m, standard_length_m",
      )
      .order("display_order", { ascending: true }),
    supabase
      .from("rebar_grade")
      .select("grade_code, yield_strength_mpa, category")
      .order("display_order", { ascending: true }),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">품목</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            공유 마스터 — 모든 책에서 같은 데이터. 철근은 KS D 3504 spec/grade 참조
          </p>
        </div>
        <span className="inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
          공유 마스터
        </span>
      </header>

      {itemsRes.error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          데이터 로딩 실패: {itemsRes.error.message}
        </div>
      ) : (
        <ItemTable
          items={itemsRes.data ?? []}
          specs={specsRes.data ?? []}
          grades={gradesRes.data ?? []}
        />
      )}
    </div>
  );
}
