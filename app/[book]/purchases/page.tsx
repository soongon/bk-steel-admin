import { createClient } from "@/lib/supabase/server";
import { type BookView, BOOK_VIEW_LABEL } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { PurchaseTable, type PurchaseListRow } from "./purchase-table";

export default async function PurchasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ book: string }>;
  searchParams: Promise<{ origin?: string }>;
}) {
  const { book } = await params;
  const { origin } = await searchParams; // hometax = 홈택스 매입 수집본에서 자동 생성(0092)
  const view = book as BookView;
  const supabase = await createClient();

  let q = supabase
    .from("purchase")
    .select(
      `
      id, book, doc_no, ordered_on, delivered_on, paid_on, payment_due_on, status,
      subtotal_krw, vat_krw, total_krw, is_documented,
      tax_doc_type, tax_doc_no, tax_invoice_received_on, partner_id, site_id, site_name, notes, origin, origin_ref,
      memo_count:purchase_memo(count), latest_memo:purchase_memo(body, created_at),
      partner:partner(id, name, code),
      site:site(id, name, code),
      purchase_line(id, acquired_qty, acquired_unit, unit_price_krw, actual_weight_kg, theoretical_weight_kg, notes, item:item(id, name, code))
    `,
    )
    .is("deleted_at", null)
    .order("ordered_on", { ascending: false })
    .order("doc_no", { ascending: false })
    // 메모 기록(0081)은 건수 + 가장 최근 1건만 — 목록 메모 칸 배지·툴팁
    .order("created_at", { referencedTable: "latest_memo", ascending: false })
    .limit(1, { referencedTable: "latest_memo" })
    .limit(100);

  if (view !== "all") q = q.eq("book", view);
  if (origin === "hometax") q = q.eq("origin", "hometax");

  const [purRes, partnersRes, itemsRes, rebarSpecsRes, bankAccountsRes, sitesRes] = await Promise.all([
    q,
    supabase
      .from("partner")
      .select("id, code, name")
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
      .from("bank_account")
      .select("id, code, bank_name, book, kind")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("book")
      .order("is_primary", { ascending: false }),
    supabase
      .from("site")
      .select("id, name")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
  ]);

  const loaded = (purRes.data as unknown as PurchaseListRow[]) ?? [];
  // 결제완료 전인데 출금이 붙은 매입(지운 매입에서 옮겨 온 결제) — 일부 지급·다 낸 상태를 출금 기준으로.
  const openIds = loaded.filter((p) => !p.paid_on).map((p) => p.id);
  const paidMap = new Map<string, number>();
  for (let i = 0; i < openIds.length; i += 100) {
    const { data } = await supabase
      .from("bank_transaction")
      .select("purchase_id, amount_krw")
      .in("purchase_id", openIds.slice(i, i + 100))
      .is("deleted_at", null)
      .lt("amount_krw", 0);
    for (const r of (data ?? []) as Array<{ purchase_id: string; amount_krw: number }>) {
      paidMap.set(r.purchase_id, (paidMap.get(r.purchase_id) ?? 0) - Number(r.amount_krw));
    }
  }
  const purchases = loaded.map((p) => (paidMap.has(p.id) ? { ...p, paid_krw: paidMap.get(p.id) } : p));

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">매입</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {BOOK_VIEW_LABEL[view]} 보기 · 최근 100건 · 발주 → 입고 → 결제 흐름
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <a href={`/${view}/purchases`} className={`rounded-full border px-2.5 py-0.5 ${origin !== "hometax" ? "bg-foreground text-background" : "hover:bg-muted"}`}>전체</a>
            <a href={`/${view}/purchases?origin=hometax`} className={`rounded-full border px-2.5 py-0.5 ${origin === "hometax" ? "bg-foreground text-background" : "hover:bg-muted"}`}>홈택스 생성</a>
          </div>
        </div>
        <BookBadge book={view} size="md" />
      </header>

      {purRes.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          데이터 로딩 실패: {purRes.error.message}
        </div>
      ) : null}

      <PurchaseTable
        purchases={purchases}
        partners={partnersRes.data ?? []}
        items={itemsRes.data ?? []}
        rebarSpecs={rebarSpecsRes.data ?? []}
        bankAccounts={bankAccountsRes.data ?? []}
        sites={sitesRes.data ?? []}
        view={view}
      />
    </div>
  );
}
