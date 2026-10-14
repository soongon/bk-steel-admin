import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { type Book, type BookView, BOOK_VIEW_LABEL } from "@/lib/book";
import { type CompanyProfile } from "@/lib/company-profile";
import { BookBadge } from "@/components/admin/book-badge";
import { fmtKrw } from "@/lib/format";
import { PURCHASE_QUOTE_STATUS_LABEL, type PurchaseQuoteStatus } from "@/lib/purchase-quote";
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

export default async function PurchaseQuotesPage({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params;
  const view = book as BookView;
  const supabase = await createClient();

  let q = supabase
    .from("purchase_quote")
    .select(
      "id, book, doc_no, quote_date, valid_until, status, prospect_name, site_name, partner:partner(name), lines:purchase_quote_line(display_name, price_per_kg_krw, sort_order)",
    )
    .is("deleted_at", null)
    .order("quote_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (view !== "all") q = q.eq("book", view);

  const [quotesRes, partnersRes, itemsRes, companyRes] = await Promise.all([
    q,
    supabase
      .from("partner")
      .select("id, name, representative, address, phone")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase.from("item").select("id, name").is("deleted_at", null).eq("is_active", true).order("name"),
    view !== "all"
      ? supabase.from("company_profile").select("*").eq("book", view)
      : supabase.from("company_profile").select("*"),
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
    partner: { name: string } | null;
    lines: Array<{ display_name: string; price_per_kg_krw: number; sort_order: number }>;
  };
  const quotes = (quotesRes.data ?? []) as unknown as Row[];

  const companies: Partial<Record<Book, CompanyProfile>> = {};
  for (const c of (companyRes.data ?? []) as CompanyProfile[]) if (c.book) companies[c.book] = c;

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

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">견적번호</TableHead>
              <TableHead className="w-24">책</TableHead>
              <TableHead className="w-32">견적일</TableHead>
              <TableHead>판매자 / 현장</TableHead>
              <TableHead>품목 · 단가(원/kg)</TableHead>
              <TableHead className="w-20 text-center">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  등록된 매입견적서가 없습니다.
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
