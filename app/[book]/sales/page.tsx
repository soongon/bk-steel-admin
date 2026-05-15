import { createClient } from "@/lib/supabase/server";
import { type BookView, BOOK_VIEW_LABEL } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { type Attachment } from "@/lib/attachment";
import { SaleTable, type SaleListRow } from "./sale-table";

export default async function SalesPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  const view = book as BookView;
  const supabase = await createClient();

  // 매출 + 거래처 + 라인 + 품목 nested fetch
  let saleQuery = supabase
    .from("sale")
    .select(
      `
      id, book, doc_no, ordered_on, delivered_on, status,
      subtotal_krw, vat_krw, total_krw, site_name, site_id, is_documented,
      tax_doc_type, payment_due_on, settled_on, partner_id, delivery_cert_id,
      site:site(id, name, code),
      partner:partner(id, name, code),
      sale_line(id, qty, unit, unit_price_krw, item:item(id, name, code))
    `,
    )
    .is("deleted_at", null)
    .order("ordered_on", { ascending: false })
    .order("doc_no", { ascending: false })
    .limit(100);

  if (view !== "all") {
    saleQuery = saleQuery.eq("book", view);
  }

  const [salesRes, partnersRes, itemsRes, rebarSpecsRes, sitesRes] = await Promise.all([
    saleQuery,
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
    supabase
      .from("site")
      .select("id, name")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
  ]);

  const sales = (salesRes.data as unknown as SaleListRow[]) ?? [];
  const saleIds = sales.map((s) => s.id);
  const attachmentsRes = saleIds.length
    ? await supabase
        .from("attachment")
        .select(
          "id, entity_type, entity_id, kind, storage, path, url, thumbnail_url, mime, bytes, width, height, caption, sort_order, created_at",
        )
        .eq("entity_type", "sale")
        .in("entity_id", saleIds)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    : { data: [] as Attachment[] };

  const attachmentsByEntity: Record<string, Attachment[]> = {};
  for (const a of (attachmentsRes.data ?? []) as Attachment[]) {
    (attachmentsByEntity[a.entity_id] ??= []).push(a);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">매출</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {BOOK_VIEW_LABEL[view]} 보기 · 최근 100건
          </p>
        </div>
        <BookBadge book={view} size="md" />
      </header>

      {salesRes.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          데이터 로딩 실패: {salesRes.error.message}
        </div>
      ) : null}

      <SaleTable
        sales={sales}
        partners={partnersRes.data ?? []}
        items={itemsRes.data ?? []}
        rebarSpecs={rebarSpecsRes.data ?? []}
        sites={sitesRes.data ?? []}
        view={view}
        attachmentsByEntity={attachmentsByEntity}
      />
    </div>
  );
}
