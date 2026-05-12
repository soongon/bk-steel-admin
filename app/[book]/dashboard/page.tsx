import { createClient } from "@/lib/supabase/server";
import { type Book, type BookView, BOOK_VIEW_LABEL, BOOKS } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { KpiCard } from "@/components/admin/kpi-card";

const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

type Row = Record<string, unknown>;
function sumBy<T extends Row>(rows: T[] | null, key: keyof T): number {
  return (rows ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);
}
function filterBook<T extends { book: string | null }>(
  rows: T[] | null,
  view: BookView,
): T[] {
  if (!rows) return [];
  if (view === "all") return rows;
  return rows.filter((r) => r.book === view);
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  const view = book as BookView;
  const supabase = await createClient();
  const monthStart = monthStartIso();

  // 5개 view·테이블 병렬 fetch
  const [pnlRes, receivableRes, payableRes, valuationRes, purchaseAggRes] =
    await Promise.all([
      supabase
        .from("vw_book_monthly_pnl_internal")
        .select("book, month, revenue_krw, cogs_krw, gross_profit_krw")
        .eq("month", monthStart),
      supabase
        .from("vw_receivable")
        .select("book, outstanding_krw, grade")
        .gt("outstanding_krw", 0),
      supabase
        .from("vw_payable")
        .select("book, outstanding_krw, grade")
        .gt("outstanding_krw", 0),
      supabase
        .from("vw_inventory_valuation")
        .select("book, valuation_krw"),
      supabase
        .from("purchase")
        .select("book, subtotal_krw")
        .gte("ordered_on", monthStart)
        .is("deleted_at", null),
    ]);

  const pnl = filterBook(pnlRes.data, view);
  const receivables = filterBook(receivableRes.data, view);
  const payables = filterBook(payableRes.data, view);
  const valuations = filterBook(valuationRes.data, view);
  const purchaseMonth = filterBook(purchaseAggRes.data, view);

  const revenue = sumBy(pnl, "revenue_krw");
  const cogs = sumBy(pnl, "cogs_krw");
  const grossProfit = sumBy(pnl, "gross_profit_krw");
  const purchaseTotal = sumBy(purchaseMonth, "subtotal_krw");
  const receivableTotal = sumBy(receivables, "outstanding_krw");
  const payableTotal = sumBy(payables, "outstanding_krw");
  const inventoryValue = sumBy(valuations, "valuation_krw");

  // 미수 등급별 breakdown
  const gradeBuckets = { normal: 0, short: 0, mid: 0, long: 0 } as Record<string, number>;
  for (const r of receivables) {
    if (r.grade && gradeBuckets[r.grade] !== undefined) {
      gradeBuckets[r.grade] += Number(r.outstanding_krw ?? 0);
    }
  }

  // 책별 분포 (전체 보기일 때만 표시)
  const byBook: Record<Book, { revenue: number; cogs: number; purchase: number; inventory: number }> = {
    bk: { revenue: 0, cogs: 0, purchase: 0, inventory: 0 },
    sl: { revenue: 0, cogs: 0, purchase: 0, inventory: 0 },
    b:  { revenue: 0, cogs: 0, purchase: 0, inventory: 0 },
  };
  for (const r of pnl) {
    if (r.book && byBook[r.book as Book]) {
      byBook[r.book as Book].revenue += Number(r.revenue_krw ?? 0);
      byBook[r.book as Book].cogs += Number(r.cogs_krw ?? 0);
    }
  }
  for (const r of purchaseMonth) {
    if (r.book && byBook[r.book as Book]) {
      byBook[r.book as Book].purchase += Number(r.subtotal_krw ?? 0);
    }
  }
  for (const r of valuations) {
    if (r.book && byBook[r.book as Book]) {
      byBook[r.book as Book].inventory += Number(r.valuation_krw ?? 0);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">대시보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {BOOK_VIEW_LABEL[view]} 보기 · {monthStart.slice(0, 7)} 기준
          </p>
        </div>
        <BookBadge book={view} size="md" />
      </header>

      {/* 메인 KPI 4개 */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="이번달 매출"
          value={fmtKrw(revenue)}
          hint={`매출원가 ${fmtKrw(cogs)} · 매출총이익 ${fmtKrw(grossProfit)}`}
          book={view}
        />
        <KpiCard
          title="이번달 매입"
          value={fmtKrw(purchaseTotal)}
          hint={`라인 ${purchaseMonth.length}건`}
        />
        <KpiCard
          title="미수금"
          value={fmtKrw(receivableTotal)}
          hint={`${receivables.length}건 미회수`}
        />
        <KpiCard
          title="외상매입금"
          value={fmtKrw(payableTotal)}
          hint={`${payables.length}건 미지급`}
        />
      </section>

      {/* 미수 등급별 */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-sm font-medium text-muted-foreground">미수 등급별 분포</h2>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {(
              [
                { key: "normal", label: "정상", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
                { key: "short", label: "단기 1~7일", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-300" },
                { key: "mid", label: "중기 8~30일", className: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300" },
                { key: "long", label: "장기 31일+", className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
              ] as const
            ).map((g) => (
              <div key={g.key} className={`rounded-lg px-2 py-2 text-center ${g.className}`}>
                <p className="text-xs opacity-80">{g.label}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {fmtKrw(gradeBuckets[g.key] ?? 0)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-sm font-medium text-muted-foreground">재고 시가 평가</h2>
          <p className="mt-3 text-2xl font-semibold tabular-nums">{fmtKrw(inventoryValue)}</p>
          {inventoryValue === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              시세 데이터 없음 — 오늘의 시세 페이지에서 입력 필요
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              현재 시가 × 잔량 합산
            </p>
          )}
        </div>
      </section>

      {/* 책별 분포 (전체 보기일 때만) */}
      {view === "all" ? (
        <section className="rounded-xl border bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="text-sm font-medium text-muted-foreground">책별 분포 (이번달)</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">책</th>
                  <th className="px-2 py-2 font-medium text-right">매출</th>
                  <th className="px-2 py-2 font-medium text-right">매입</th>
                  <th className="px-2 py-2 font-medium text-right">매출원가</th>
                  <th className="px-2 py-2 font-medium text-right">재고 시가</th>
                </tr>
              </thead>
              <tbody>
                {BOOKS.map((b) => (
                  <tr key={b} className="border-t border-border/60">
                    <td className="px-2 py-2">
                      <BookBadge book={b} />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtKrw(byBook[b].revenue)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtKrw(byBook[b].purchase)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {fmtKrw(byBook[b].cogs)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {fmtKrw(byBook[b].inventory)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* 에러 노출 (디버깅용 — 운영 시 제거 가능) */}
      {pnlRes.error || receivableRes.error || payableRes.error || valuationRes.error || purchaseAggRes.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          데이터 로딩 일부 실패:
          <ul className="ml-4 list-disc">
            {pnlRes.error && <li>pnl: {pnlRes.error.message}</li>}
            {receivableRes.error && <li>receivable: {receivableRes.error.message}</li>}
            {payableRes.error && <li>payable: {payableRes.error.message}</li>}
            {valuationRes.error && <li>valuation: {valuationRes.error.message}</li>}
            {purchaseAggRes.error && <li>purchase: {purchaseAggRes.error.message}</li>}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
