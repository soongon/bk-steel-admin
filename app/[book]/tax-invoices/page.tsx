import Link from "next/link";
import { ReceiptTextIcon, AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BookBadge } from "@/components/admin/book-badge";
import { type Book } from "@/lib/book";
import { fmtKrw } from "@/lib/format";
import { TAX_INVOICE_STATE_KO, type TaxInvoiceState } from "@/lib/tax-invoice";

const STATE_BADGE: Record<string, string> = {
  issuing: "bg-amber-100 text-amber-700",
  issued: "bg-blue-100 text-blue-700",
  nts_sent: "bg-blue-100 text-blue-700",
  nts_approved: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

/** YYYY-MM → 다음 달 첫날 YYYY-MM-DD (write_date < next 로 월 범위). */
function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m >= 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = (y * 12 + (m - 1)) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/**
 * 세금계산서 — 발행 목록 + 월 합계(부가세 신고용) + 자료매출 미발행 경고.
 * B계좌는 발행 대상 아님(무자료). 'all'은 BK+SL 합산.
 */
export default async function TaxInvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ book: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { book: bookParam } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const nowMonth = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : nowMonth;
  const monthStart = `${month}-01`;
  const monthEnd = nextMonthStart(month);
  const isAll = bookParam === "all";
  const isB = bookParam === "b";

  // 발행된 세금계산서(이 달 작성)
  let invQ = supabase
    .from("tax_invoice")
    .select("id, book, sale_id, state, nts_confirm_num, write_date, supply_krw, vat_krw, total_krw, item_summary, buyer, provider")
    .is("deleted_at", null)
    .neq("state", "cancelled")
    .gte("write_date", monthStart)
    .lt("write_date", monthEnd)
    .order("write_date", { ascending: false });
  if (!isAll) invQ = invQ.eq("book", bookParam);
  const { data: invData } = await invQ;
  const rows = (invData ?? []) as Record<string, any>[];

  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const supplySum = sum("supply_krw");
  const vatSum = sum("vat_krw");
  const totalSum = sum("total_krw");

  // 자료 매출(세금계산서 대상)인데 미발행 — 이 달 주문 기준
  let saleQ = supabase
    .from("sale")
    .select("id, doc_no, ordered_on, book, total_krw, tax_doc_type, partner:partner(name)")
    .is("deleted_at", null)
    .eq("is_documented", true)
    .in("tax_doc_type", ["tax_invoice_electronic", "tax_invoice_paper", "invoice"])
    .neq("status", "cancelled")
    .gte("ordered_on", monthStart)
    .lt("ordered_on", monthEnd)
    .order("ordered_on", { ascending: false });
  if (isAll) saleQ = saleQ.in("book", ["bk", "sl"]);
  else saleQ = saleQ.eq("book", bookParam);
  const { data: saleData } = await saleQ;
  const docSales = (saleData ?? []) as Record<string, any>[];

  const { data: coveredRows } = await supabase
    .from("tax_invoice")
    .select("sale_id")
    .is("deleted_at", null)
    .neq("state", "cancelled");
  const covered = new Set((coveredRows ?? []).map((r) => (r as any).sale_id));
  const missing = docSales.filter((s) => !covered.has(s.id));

  const linkBase = `/${bookParam}/tax-invoices`;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      {/* 헤더 + 월 이동 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ReceiptTextIcon className="size-5" />
          <h1 className="text-lg font-semibold">세금계산서</h1>
          {!isAll ? <BookBadge book={bookParam as Book} /> : null}
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`${linkBase}?month=${shiftMonth(month, -1)}`}
            className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted"
          >
            <ChevronLeftIcon className="size-4" />
          </Link>
          <form className="contents">
            <input
              type="month"
              name="month"
              defaultValue={month}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            />
            <button type="submit" className="h-8 rounded-md border px-2 text-sm hover:bg-muted">
              조회
            </button>
          </form>
          <Link
            href={`${linkBase}?month=${shiftMonth(month, 1)}`}
            className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted"
          >
            <ChevronRightIcon className="size-4" />
          </Link>
        </div>
      </div>

      {isB ? (
        <div className="rounded-lg border-2 border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
          B계좌는 무자료 거래라 세금계산서 발행 대상이 아닙니다.
        </div>
      ) : null}

      {/* 월 합계(부가세 신고용) */}
      <section className="grid gap-3 sm:grid-cols-4">
        <SumCard label={`${month} 발행`} value={`${rows.length}건`} />
        <SumCard label="공급가액 합" value={fmtKrw(supplySum)} />
        <SumCard label="세액 합" value={fmtKrw(vatSum)} />
        <SumCard label="합계" value={fmtKrw(totalSum)} strong />
      </section>

      {/* 미발행 경고 */}
      {missing.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 border-b border-amber-200 px-4 py-2 text-sm font-medium text-amber-800 dark:border-amber-900 dark:text-amber-200">
            <AlertTriangleIcon className="size-4" />
            자료 매출인데 세금계산서 미발행 — {missing.length}건
          </div>
          <ul className="divide-y divide-amber-100 text-sm dark:divide-amber-900/50">
            {missing.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <Link href={`/${s.book}/sales/${s.id}`} className="flex items-center gap-2 hover:underline">
                  <span className="font-mono text-xs">{s.doc_no}</span>
                  <span className="text-muted-foreground">{(s.partner as any)?.name ?? "—"}</span>
                </Link>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{s.ordered_on}</span>
                  <span className="tabular-nums">{fmtKrw(Number(s.total_krw))}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 발행 목록 */}
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-4 py-2 text-sm font-medium">발행 목록 ({rows.length}건)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">작성일</th>
                <th className="px-2 py-2 text-left font-medium">거래처</th>
                <th className="px-2 py-2 text-left font-medium">품목</th>
                <th className="px-2 py-2 text-right font-medium">공급가액</th>
                <th className="px-2 py-2 text-right font-medium">세액</th>
                <th className="px-2 py-2 text-right font-medium">합계</th>
                <th className="px-2 py-2 text-center font-medium">구분</th>
                <th className="px-2 py-2 text-center font-medium">상태</th>
                <th className="px-4 py-2 text-left font-medium">승인번호</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    이 달 발행된 세금계산서가 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono text-xs">{r.write_date}</td>
                    <td className="px-2 py-2">
                      <Link href={`/${r.book}/sales/${r.sale_id}`} className="hover:underline">
                        {(r.buyer as any)?.name ?? "—"}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{r.item_summary ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtKrw(Number(r.supply_krw))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtKrw(Number(r.vat_krw))}</td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{fmtKrw(Number(r.total_krw))}</td>
                    <td className="px-2 py-2 text-center text-xs">{r.provider === "manual" ? "수기" : "전자"}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${STATE_BADGE[r.state] ?? "bg-muted"}`}>
                        {TAX_INVOICE_STATE_KO[r.state as TaxInvoiceState] ?? r.state}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{r.nts_confirm_num ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        ※ 부가세 신고 자료(자료 거래 · B계좌 제외). 세금계산서 발행은 각 매출 상세의 거래 진행 패널에서.
      </p>
    </div>
  );
}

function SumCard({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 tabular-nums ${strong ? "text-lg font-semibold" : "text-base"}`}>{value}</div>
    </div>
  );
}
