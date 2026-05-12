import { createClient } from "@/lib/supabase/server";
import { type BookView, BOOK_VIEW_LABEL } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { PurchaseTable, type PurchaseListRow } from "./purchase-table";

export default async function PurchasesPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  const view = book as BookView;
  const supabase = await createClient();

  let q = supabase
    .from("purchase")
    .select(
      `
      id, book, doc_no, ordered_on, delivered_on, paid_on, payment_due_on, status,
      subtotal_krw, vat_krw, total_krw, is_documented,
      tax_doc_type, tax_doc_no, partner_id, notes,
      partner:partner(id, name, code),
      purchase_line(id, acquired_qty, acquired_unit, unit_price_krw, actual_weight_kg, theoretical_weight_kg, item:item(id, name, code))
    `,
    )
    .is("deleted_at", null)
    .order("ordered_on", { ascending: false })
    .order("doc_no", { ascending: false })
    .limit(100);

  if (view !== "all") q = q.eq("book", view);

  const [purRes, partnersRes, itemsRes, rebarSpecsRes] = await Promise.all([
    q,
    supabase
      .from("partner")
      .select("id, code, name")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("item")
      .select("id, code, name, category, rebar_spec_code, rebar_grade_code, length_m")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("rebar_spec")
      .select(
        "spec_code, unit_weight_kg_per_m, standard_length_m, bars_per_bundle, bundle_weight_kg",
      )
      .order("display_order"),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">매입</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {BOOK_VIEW_LABEL[view]} 보기 · 최근 100건 · 발주 → 입고 → 결제 흐름
          </p>
        </div>
        <BookBadge book={view} size="md" />
      </header>

      {purRes.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          데이터 로딩 실패: {purRes.error.message}
        </div>
      ) : null}

      <PurchaseTable
        purchases={(purRes.data as unknown as PurchaseListRow[]) ?? []}
        partners={partnersRes.data ?? []}
        items={itemsRes.data ?? []}
        rebarSpecs={rebarSpecsRes.data ?? []}
        view={view}
      />
    </div>
  );
}
