import { createClient } from "@/lib/supabase/server";
import { type BookView, BOOK_VIEW_LABEL } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { fetchAllCompanyProfiles } from "@/lib/company-profile";
import { SaleTable, type SaleListRow } from "./sale-table";
import { SaleFilters } from "./sale-filters";

type SearchParams = {
  from?: string;
  to?: string;
  partner?: string;
  status?: string;
  doc?: string;
  grade?: string;
};

export default async function SalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ book: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { book } = await params;
  const sp = await searchParams;
  const view = book as BookView;
  const supabase = await createClient();

  const hasServerFilter = !!(sp.from || sp.to || sp.partner || sp.status || sp.doc);
  const hasAnyFilter = hasServerFilter || !!sp.grade;

  // 매출 + 거래처 + 라인 + 품목 nested fetch (필터 시 상한 확대)
  let saleQuery = supabase
    .from("sale")
    .select(
      `
      id, book, doc_no, ordered_on, delivered_on, status,
      subtotal_krw, vat_krw, total_krw, site_name, site_id, is_documented,
      tax_doc_type, payment_due_on, settled_on, partner_id, delivery_cert_id, notes,
      site:site(id, name, code),
      partner:partner(id, name, code),
      sale_line(id, qty, unit, unit_price_krw, item:item(id, name, code))
    `,
    )
    .is("deleted_at", null)
    .order("ordered_on", { ascending: false })
    .order("doc_no", { ascending: false });

  if (view !== "all") saleQuery = saleQuery.eq("book", view);
  if (sp.from) saleQuery = saleQuery.gte("ordered_on", sp.from);
  if (sp.to) saleQuery = saleQuery.lte("ordered_on", sp.to);
  if (sp.partner) saleQuery = saleQuery.eq("partner_id", sp.partner);
  if (sp.status) saleQuery = saleQuery.eq("status", sp.status);
  if (sp.doc === "y") saleQuery = saleQuery.eq("is_documented", true);
  else if (sp.doc === "n") saleQuery = saleQuery.eq("is_documented", false);
  saleQuery = saleQuery.limit(hasAnyFilter ? 500 : 100);

  const [salesRes, partnersRes, itemsRes, rebarSpecsRes, sitesRes, bankAccountsRes, companies] = await Promise.all([
    saleQuery,
    supabase
      .from("partner")
      .select("id, code, name, business_no, representative, address, phone, fax, industry")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("item")
      .select("id, code, name, category, rebar_spec_code, rebar_grade_code, length_m, bars_per_tonne")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("rebar_spec")
      .select(
        "spec_code, unit_weight_kg_per_m, standard_length_m",
      )
      .order("display_order"),
    supabase
      .from("site")
      .select("id, name")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("bank_account")
      .select("id, code, bank_name, book, kind")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("book")
      .order("is_primary", { ascending: false }),
    fetchAllCompanyProfiles(supabase),
  ]);

  const sales = (salesRes.data as unknown as SaleListRow[]) ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">매출</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {BOOK_VIEW_LABEL[view]} 보기 · {hasAnyFilter ? "필터 적용" : "최근 100건"}
          </p>
        </div>
        <BookBadge book={view} size="md" />
      </header>

      <SaleFilters partners={partnersRes.data ?? []} />

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
        bankAccounts={bankAccountsRes.data ?? []}
        companies={companies}
        view={view}
        gradeFilter={sp.grade ?? ""}
      />
    </div>
  );
}
