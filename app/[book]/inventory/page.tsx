import { createClient } from "@/lib/supabase/server";
import { type BookView, BOOK_VIEW_LABEL } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import {
  InventoryTable,
  type SummaryRow,
  type LotRow,
  type ItemInfo,
} from "./inventory-table";

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  const view = book as BookView;
  const supabase = await createClient();

  let summaryQ = supabase
    .from("vw_inventory_by_book_item")
    .select("book, item_id, total_qty, total_weight_kg, line_count");
  let valuationQ = supabase
    .from("vw_inventory_valuation")
    .select("book, item_id, market_price_per_kg, valuation_krw");
  let lotsQ = supabase
    .from("vw_inventory")
    .select(
      "purchase_line_id, book, item_id, warehouse_id, acquired_unit, acquired_qty, remaining_qty, theoretical_weight_kg, actual_weight_kg, remaining_weight_kg, unit_price_krw, grade, length_mm, bars_count, status, acquired_at",
    );

  if (view !== "all") {
    summaryQ = summaryQ.eq("book", view);
    valuationQ = valuationQ.eq("book", view);
    lotsQ = lotsQ.eq("book", view);
  }

  const [summaryRes, valuationRes, lotsRes] = await Promise.all([
    summaryQ,
    valuationQ,
    lotsQ,
  ]);

  const error = summaryRes.error ?? valuationRes.error ?? lotsRes.error;

  // item_id 모음 → item 정보 batch fetch
  const itemIdSet = new Set<string>();
  for (const r of summaryRes.data ?? []) itemIdSet.add(r.item_id);
  for (const r of lotsRes.data ?? []) itemIdSet.add(r.item_id);

  const { data: itemsData } = itemIdSet.size
    ? await supabase
        .from("item")
        .select("id, code, name, category, rebar_spec_code, rebar_grade_code, length_m")
        .in("id", Array.from(itemIdSet))
    : { data: [] as ItemInfo[] };

  const itemMap = new Map<string, ItemInfo>();
  for (const i of (itemsData ?? []) as ItemInfo[]) itemMap.set(i.id, i);

  // summary + valuation merge by `${book}::${item_id}` key
  const valuationMap = new Map<string, { market_price_per_kg: number | null; valuation_krw: number | null }>();
  for (const v of valuationRes.data ?? []) {
    valuationMap.set(`${v.book}::${v.item_id}`, {
      market_price_per_kg: v.market_price_per_kg,
      valuation_krw: v.valuation_krw,
    });
  }

  const summary: SummaryRow[] = (summaryRes.data ?? []).map((s) => {
    const key = `${s.book}::${s.item_id}`;
    const val = valuationMap.get(key);
    return {
      book: s.book,
      item_id: s.item_id,
      total_qty: Number(s.total_qty ?? 0),
      total_weight_kg: s.total_weight_kg != null ? Number(s.total_weight_kg) : null,
      line_count: Number(s.line_count ?? 0),
      market_price_per_kg: val?.market_price_per_kg != null ? Number(val.market_price_per_kg) : null,
      valuation_krw: val?.valuation_krw != null ? Number(val.valuation_krw) : null,
      item: itemMap.get(s.item_id) ?? null,
    };
  });

  // lots group by `${book}::${item_id}`
  const lotsByItem: Record<string, LotRow[]> = {};
  for (const lot of lotsRes.data ?? []) {
    const key = `${lot.book}::${lot.item_id}`;
    (lotsByItem[key] ??= []).push({
      purchase_line_id: lot.purchase_line_id,
      book: lot.book,
      item_id: lot.item_id,
      warehouse_id: lot.warehouse_id,
      acquired_unit: lot.acquired_unit,
      acquired_qty: Number(lot.acquired_qty),
      remaining_qty: Number(lot.remaining_qty),
      theoretical_weight_kg: lot.theoretical_weight_kg != null ? Number(lot.theoretical_weight_kg) : null,
      actual_weight_kg: lot.actual_weight_kg != null ? Number(lot.actual_weight_kg) : null,
      remaining_weight_kg: lot.remaining_weight_kg != null ? Number(lot.remaining_weight_kg) : null,
      unit_price_krw: Number(lot.unit_price_krw),
      grade: lot.grade,
      length_mm: lot.length_mm,
      bars_count: lot.bars_count,
      status: lot.status,
      acquired_at: lot.acquired_at,
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">재고</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {BOOK_VIEW_LABEL[view]} 보기 · 개별법 ledger (purchase_line − allocation)
          </p>
        </div>
        <BookBadge book={view} size="md" />
      </header>

      {error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          데이터 로딩 실패: {error.message}
        </div>
      ) : (
        <InventoryTable summary={summary} lotsByItem={lotsByItem} view={view} />
      )}
    </div>
  );
}
