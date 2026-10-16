import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { type Book, type BookView, BOOK_VIEW_LABEL, BOOKS } from "@/lib/book";
import { type CompanyProfile, fetchCompanyProfile } from "@/lib/company-profile";
import { STEEL_CUSTOM_ITEM_ID } from "@/lib/transaction-draft";
import { BookBadge } from "@/components/admin/book-badge";
import { fmtKrw } from "@/lib/format";
import { PURCHASE_QUOTE_STATUS_LABEL, type PurchaseQuoteStatus } from "@/lib/purchase-quote";
import { LEAD_FILTER_NONE, LEAD_SOURCES, type LeadSource, isLeadSource } from "@/lib/lead-source";
import { LeadSourceBadge } from "@/components/admin/lead-source-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PurchaseQuoteButton,
  type PurchaseQuoteSources,
  type PurchaseQuotePartner,
  type PurchaseQuoteItemOption,
} from "@/components/admin/purchase-quote-dialog";

export default async function PurchaseQuotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ book: string }>;
  searchParams: Promise<{ lead?: string }>;
}) {
  const { book } = await params;
  const { lead: leadParam } = await searchParams;
  const view = book as BookView;
  const supabase = await createClient();

  // 유입경로 필터(0079) — ?lead=homepage… 또는 ?lead=none(미기록). 그 외 값은 무시.
  const leadFilter: LeadSource | typeof LEAD_FILTER_NONE | null =
    leadParam === LEAD_FILTER_NONE ? LEAD_FILTER_NONE : isLeadSource(leadParam) ? leadParam : null;

  let q = supabase
    .from("purchase_quote")
    .select(
      "id, book, doc_no, quote_date, valid_until, status, prospect_name, site_name, lead_source, lead_note, partner:partner(name), lines:purchase_quote_line(display_name, price_per_kg_krw, sort_order)",
    )
    .is("deleted_at", null)
    .order("quote_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (view !== "all") q = q.eq("book", view);
  if (leadFilter === LEAD_FILTER_NONE) q = q.is("lead_source", null);
  else if (leadFilter) q = q.eq("lead_source", leadFilter);

  // 유입경로별 건수(책 범위 전체, 필터 무관) — 칩에 표시. 견적 테이블은 작아 전부 읽어 세어도 된다.
  let countQ = supabase.from("purchase_quote").select("lead_source").is("deleted_at", null);
  if (view !== "all") countQ = countQ.eq("book", view);

  const [quotesRes, countRes, partnersRes, itemsRes, companyRes] = await Promise.all([
    q,
    countQ,
    supabase
      .from("partner")
      .select("id, name, representative, address, phone")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase.from("item").select("id, name").is("deleted_at", null).eq("is_active", true).neq("id", STEEL_CUSTOM_ITEM_ID).order("name"),
    // 책별 회사정보 — B계좌는 SL 폴백(fetchCompanyProfile)까지 적용해 상세와 같은 공급자로 미리보기.
    Promise.all((view !== "all" ? [view as Book] : [...BOOKS]).map((b) => fetchCompanyProfile(supabase, b))),
  ]);

  type Row = {
    id: string;
    book: Book;
    doc_no: string;
    quote_date: string;
    valid_until: string | null;
    status: PurchaseQuoteStatus;
    prospect_name: string | null;
    site_name: string | null;
    lead_source: string | null;
    lead_note: string | null;
    partner: { name: string } | null;
    lines: Array<{ display_name: string; price_per_kg_krw: number; sort_order: number }>;
  };
  const quotes = (quotesRes.data ?? []) as unknown as Row[];

  const leadCounts: Record<string, number> = {};
  let leadTotal = 0;
  for (const r of (countRes.data ?? []) as Array<{ lead_source: string | null }>) {
    const k = r.lead_source ?? LEAD_FILTER_NONE;
    leadCounts[k] = (leadCounts[k] ?? 0) + 1;
    leadTotal += 1;
  }
  const leadChips: Array<{ key: string | null; label: string; count: number }> = [
    { key: null, label: "전체", count: leadTotal },
    ...LEAD_SOURCES.map((s) => ({ key: s.value as string, label: s.label, count: leadCounts[s.value] ?? 0 })),
    { key: LEAD_FILTER_NONE, label: "미기록", count: leadCounts[LEAD_FILTER_NONE] ?? 0 },
  ];
  const chipCls = (on: boolean) =>
    `inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs ${on ? "bg-foreground text-background" : "bg-background hover:bg-muted"}`;

  const companies: Partial<Record<Book, CompanyProfile>> = {};
  (view !== "all" ? [view as Book] : [...BOOKS]).forEach((b, i) => {
    const c = companyRes[i];
    if (c) companies[b] = c;
  });

  const sources: PurchaseQuoteSources = {
    partners: (partnersRes.data ?? []) as PurchaseQuotePartner[],
    items: (itemsRes.data ?? []) as PurchaseQuoteItemOption[],
    companies,
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">매입견적서</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {BOOK_VIEW_LABEL[view]} · 최근 100건 · 우리가 사는 쪽의 kg당 단가 견적 (총중량·금액은 당일 계근 후 확정)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BookBadge book={view} size="md" />
          <PurchaseQuoteButton sources={sources} book={view} />
        </div>
      </header>

      {/* 유입경로 칩 — 어디서 문의가 오는지 한눈에. 미기록이 많으면 통화 때 묻는 습관부터. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">유입경로</span>
        {leadChips.map((c) => {
          const on = c.key === leadFilter;
          return (
            <Link key={c.key ?? "all"} href={c.key ? `/${view}/purchase-quotes?lead=${c.key}` : `/${view}/purchase-quotes`} className={chipCls(on)}>
              {c.label}
              <span className={`tabular-nums ${on ? "opacity-80" : "text-muted-foreground"}`}>{c.count}</span>
            </Link>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">견적번호</TableHead>
              <TableHead className="w-24">책</TableHead>
              <TableHead className="w-32">견적일</TableHead>
              <TableHead>판매자 / 현장</TableHead>
              <TableHead className="w-28">유입</TableHead>
              <TableHead>품목 · 단가(원/kg)</TableHead>
              <TableHead className="w-20 text-center">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  {leadFilter ? "이 유입경로의 매입견적서가 없습니다." : "등록된 매입견적서가 없습니다."}
                </TableCell>
              </TableRow>
            ) : (
              quotes.map((s) => {
                const st = PURCHASE_QUOTE_STATUS_LABEL[s.status] ?? { label: s.status, cls: "" };
                const lines = [...(s.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/${s.book}/purchase-quotes/${s.id}`} className="hover:underline">
                        {s.doc_no}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <BookBadge book={s.book} />
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      <div>{s.quote_date}</div>
                      {s.valid_until ? <div className="text-muted-foreground">~{s.valid_until}</div> : null}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{s.partner?.name ?? s.prospect_name ?? "—"}</div>
                      {s.site_name ? <div className="text-xs text-muted-foreground">{s.site_name}</div> : null}
                    </TableCell>
                    <TableCell>
                      <LeadSourceBadge source={s.lead_source} note={s.lead_note} />
                      {s.lead_note ? <div className="mt-0.5 max-w-[10rem] truncate text-[10px] text-muted-foreground" title={s.lead_note}>{s.lead_note}</div> : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {lines.slice(0, 2).map((l, i) => (
                        <div key={i} className="tabular-nums">
                          {l.display_name} <span className="font-medium">{fmtKrw(Number(l.price_per_kg_krw))}</span>/kg
                        </div>
                      ))}
                      {lines.length > 2 ? <div className="text-muted-foreground">외 {lines.length - 2}건</div> : null}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${st.cls}`}>{st.label}</span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
