import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { type Book, type BookView, BOOK_VIEW_LABEL } from "@/lib/book";
import { type CompanyProfile } from "@/lib/company-profile";
import { BookBadge } from "@/components/admin/book-badge";
import { fmtKrw } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  QuoteButton,
  type QuoteSources,
  type QuotePartner,
  type QuoteItem,
  type QuoteRebarSpec,
} from "@/components/admin/quote-dialog";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: "작성", cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
  sent: { label: "발송", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  won: { label: "수주", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  expired: { label: "만료", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
};

export default async function QuotesPage({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params;
  const view = book as BookView;
  const supabase = await createClient();

  let q = supabase
    .from("quote")
    .select("id, book, doc_no, quote_date, valid_until, status, prospect_name, site_name, total_krw, partner:partner(name)")
    .is("deleted_at", null)
    .order("quote_date", { ascending: false })
    .limit(100);
  if (view !== "all") q = q.eq("book", view);

  const [quotesRes, partnersRes, itemsRes, rebarSpecsRes, companyRes] = await Promise.all([
    q,
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
    supabase.from("rebar_spec").select("spec_code, unit_weight_kg_per_m, standard_length_m").order("display_order"),
    view !== "all"
      ? supabase.from("company_profile").select("*").eq("book", view)
      : supabase.from("company_profile").select("*"),
  ]);

  const quotes = (quotesRes.data ?? []) as unknown as Array<{
    id: string;
    book: BookView;
    doc_no: string;
    quote_date: string;
    valid_until: string | null;
    status: string;
    prospect_name: string | null;
    site_name: string | null;
    total_krw: number;
    partner: { name: string } | null;
  }>;

  // 전체보기(/all)에서도 작성 가능 — 책별 공급자를 모두 로드해 폼의 책 선택에 매핑.
  const companies: Partial<Record<Book, CompanyProfile>> = {};
  for (const c of (companyRes.data ?? []) as CompanyProfile[]) {
    if (c.book) companies[c.book as Book] = c;
  }

  const sources: QuoteSources = {
    partners: (partnersRes.data ?? []) as QuotePartner[],
    items: (itemsRes.data ?? []) as QuoteItem[],
    rebarSpecs: (rebarSpecsRes.data ?? []) as QuoteRebarSpec[],
    companies,
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">견적서</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {BOOK_VIEW_LABEL[view]} · 최근 100건 · 작성 시 책 선택 · 거래처 없이 현장명·잠재 고객만으로도 가능
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BookBadge book={view} size="md" />
          <QuoteButton sources={sources} book={view} label="견적서 작성" />
        </div>
      </header>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">견적번호</TableHead>
              <TableHead className="w-24">책</TableHead>
              <TableHead className="w-32">견적일</TableHead>
              <TableHead>거래처 / 현장</TableHead>
              <TableHead className="w-28 text-right">합계</TableHead>
              <TableHead className="w-20 text-center">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  등록된 견적서가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              quotes.map((s) => {
                const st = STATUS_LABEL[s.status] ?? { label: s.status, cls: "" };
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/${s.book}/quotes/${s.id}`} className="hover:underline">
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
                    <TableCell className="text-right tabular-nums">{fmtKrw(s.total_krw)}</TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${st.cls}`}>
                        {st.label}
                      </span>
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
