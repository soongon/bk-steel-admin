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
  origin?: string; // hometax = 홈택스 수집본에서 자동 생성된 매출(0087)
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

  const hasServerFilter = !!(sp.from || sp.to || sp.partner || sp.status || sp.doc || sp.origin);
  const hasAnyFilter = hasServerFilter || !!sp.grade;

  // 매출 + 거래처 + 라인 + 품목 nested fetch (필터 시 상한 확대)
  let saleQuery = supabase
    .from("sale")
    .select(
      `
      id, book, doc_no, ordered_on, delivered_on, status,
      subtotal_krw, vat_krw, total_krw, site_name, site_id, is_documented,
      tax_doc_type, payment_due_on, settled_on, partner_id, delivery_cert_id, notes,
      statement_sent_on, tax_invoice_issued_on, origin, origin_ref,
      memo_count:sale_memo(count), latest_memo:sale_memo(body, created_at),
      site:site(id, name, code),
      partner:partner(id, name, code),
      sale_line(id, qty, unit, unit_price_krw, display_name, item:item(id, name, code))
    `,
    )
    .is("deleted_at", null)
    .order("ordered_on", { ascending: false })
    .order("doc_no", { ascending: false })
    // 메모 기록(0080)은 건수 + 가장 최근 1건만 — 목록 메모 칸 배지·툴팁
    .order("created_at", { referencedTable: "latest_memo", ascending: false })
    .limit(1, { referencedTable: "latest_memo" });

  if (view !== "all") saleQuery = saleQuery.eq("book", view);
  if (sp.from) saleQuery = saleQuery.gte("ordered_on", sp.from);
  if (sp.to) saleQuery = saleQuery.lte("ordered_on", sp.to);
  if (sp.partner) saleQuery = saleQuery.eq("partner_id", sp.partner);
  if (sp.status) saleQuery = saleQuery.eq("status", sp.status);
  if (sp.doc === "y") saleQuery = saleQuery.eq("is_documented", true);
  else if (sp.doc === "n") saleQuery = saleQuery.eq("is_documented", false);
  if (sp.origin === "hometax") saleQuery = saleQuery.eq("origin", "hometax");
  saleQuery = saleQuery.limit(hasAnyFilter ? 500 : 100);

  const [salesRes, partnersRes, itemsRes, rebarSpecsRes, sitesRes, bankAccountsRes, companies] = await Promise.all([
    saleQuery,
    supabase
      .from("partner")
      .select("id, code, name, business_no, representative, address, phone, fax, business_type, business_item")
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

  const loaded = (salesRes.data as unknown as SaleListRow[]) ?? [];
  // 수금완료 전인데 입금이 붙은 매출(지운 매출에서 옮겨 온 수금) — 미수 등급을 입금 기준으로.
  const openIds = loaded.filter((s) => s.status !== "settled" && s.status !== "cancelled").map((s) => s.id);
  const received = new Map<string, number>();
  for (let i = 0; i < openIds.length; i += 100) {
    const { data } = await supabase
      .from("bank_transaction")
      .select("sale_id, amount_krw")
      .in("sale_id", openIds.slice(i, i + 100))
      .is("deleted_at", null)
      .gt("amount_krw", 0);
    for (const r of (data ?? []) as Array<{ sale_id: string; amount_krw: number }>) {
      received.set(r.sale_id, (received.get(r.sale_id) ?? 0) + Number(r.amount_krw));
    }
  }
  const sales = loaded.map((s) => (received.has(s.id) ? { ...s, received_krw: received.get(s.id) } : s));

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
