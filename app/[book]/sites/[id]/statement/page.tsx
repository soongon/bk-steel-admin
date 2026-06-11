import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";
import { buttonVariants } from "@/components/ui/button";
import { BookBadge } from "@/components/admin/book-badge";
import { PrintButton } from "@/components/admin/print-button";
import {
  TradingStatement,
  type StatementData,
  type StatementLine,
} from "@/components/admin/trading-statement";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { fmtKrw } from "@/lib/format";

export default async function SiteStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ book: string; id: string }>;
  searchParams: Promise<{ partner?: string; book?: string }>;
}) {
  const { book: bookParam, id } = await params;
  const sp = await searchParams;
  const partnerId = sp.partner;
  const groupBook = sp.book as Book | undefined;

  if (!partnerId || !groupBook) notFound();

  const supabase = await createClient();

  // 1. 현장
  const { data: site } = await supabase
    .from("site")
    .select("id, code, name, address, client_name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!site) notFound();

  // 2. 거래처
  const { data: partner } = await supabase
    .from("partner")
    .select("id, code, name, business_no, representative, address, phone, fax, industry")
    .eq("id", partnerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!partner) notFound();

  // 3. 그 (book, partner, site) 의 매출 + 라인
  const { data: sales } = await supabase
    .from("sale")
    .select(
      `
      id, doc_no, ordered_on, delivered_on, status,
      subtotal_krw, vat_krw, total_krw, vat_rate, is_documented,
      tax_doc_no, notes,
      sale_line(
        id, qty, unit, unit_price_krw, weight_kg, theoretical_weight_kg, line_subtotal_krw,
        item:item(id, name, category, rebar_spec_code, rebar_grade_code, length_m)
      )
    `,
    )
    .eq("book", groupBook)
    .eq("partner_id", partnerId)
    .eq("site_id", id)
    .is("deleted_at", null)
    .order("ordered_on");

  if (!sales || sales.length === 0) notFound();

  // 4. 공급자
  const company = await fetchCompanyProfile(supabase, groupBook);

  // 5. StatementData 구성 (라인들 모두 모음, 라인별 ordered_on 보존)
  type RawLine = {
    qty: number | string;
    unit: string;
    unit_price_krw: number | string;
    weight_kg: number | string | null;
    theoretical_weight_kg: number | string | null;
    line_subtotal_krw: number | string | null;
    item: {
      name: string;
      category: string | null;
      rebar_spec_code: string | null;
      rebar_grade_code: string | null;
      length_m: number | null;
    } | null;
  };
  type RawSale = {
    id: string;
    doc_no: string;
    ordered_on: string;
    subtotal_krw: number | string;
    vat_krw: number | string;
    total_krw: number | string;
    vat_rate: number | string | null;
    is_documented: boolean;
    notes: string | null;
    sale_line: RawLine[];
  };

  const rawSales = sales as unknown as RawSale[];

  let subtotal = 0;
  let vat = 0;
  let total = 0;
  const lines: StatementLine[] = [];
  const allDocs: string[] = [];
  let anyUndocumented = false;

  for (const s of rawSales) {
    subtotal += Number(s.subtotal_krw);
    vat += Number(s.vat_krw);
    total += Number(s.total_krw);
    if (!s.is_documented) anyUndocumented = true;
    allDocs.push(s.doc_no);
    for (const l of s.sale_line) {
      const lineSubtotal = Number(l.line_subtotal_krw ?? Number(l.qty) * Number(l.unit_price_krw));
      const vatRate = Number(s.vat_rate ?? 10);
      const lineVat = s.is_documented ? Math.round((lineSubtotal * vatRate) / 100) : 0;
      let spec = "";
      if (l.item?.category === "rebar" && l.item?.rebar_spec_code) {
        spec = [
          l.item.rebar_spec_code,
          l.item.rebar_grade_code,
          l.item.length_m ? `${l.item.length_m}M` : null,
        ]
          .filter(Boolean)
          .join(" ");
      }
      lines.push({
        item_name: l.item?.name ?? "—",
        spec,
        qty: Number(l.qty),
        unit: l.unit,
        unit_price_krw: Number(l.unit_price_krw),
        subtotal_krw: lineSubtotal,
        vat_krw: lineVat,
        weight_kg:
          l.theoretical_weight_kg != null
            ? Number(l.theoretical_weight_kg)
            : l.weight_kg != null
              ? Number(l.weight_kg)
              : null,
        ordered_on: s.ordered_on,
      });
    }
  }

  const firstSale = rawSales[0];
  const lastSale = rawSales[rawSales.length - 1];

  const data: StatementData = {
    doc_no: `${site.code}/${partner.code} (${rawSales.length}건)`,
    ordered_on: firstSale.ordered_on,
    tax_doc_no: null,
    partner: {
      name: partner.name,
      business_no: partner.business_no,
      representative: partner.representative,
      address: partner.address,
      phone: partner.phone,
      fax: partner.fax,
      industry: partner.industry,
    },
    site_name: `${site.name} (${site.code})`,
    is_documented: !anyUndocumented,
    lines,
    subtotal_krw: subtotal,
    vat_krw: vat,
    total_krw: total,
    notes: `납품기간 ${firstSale.ordered_on} ~ ${lastSale.ordered_on} · 매출 ${rawSales.length}건 [${allDocs.join(", ")}]`,
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* 액션 바 (인쇄 시 숨김) */}
      <div className="flex items-center justify-between gap-4 border-b bg-card px-6 py-3 print:hidden">
        <Link
          href={`/${bookParam}/sites/${id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeftIcon className="size-4" />
          현장 상세
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-sm">
            {partner.name} · {site.name}
          </span>
          <BookBadge book={groupBook} />
          <span className="text-xs text-muted-foreground">
            누적 {rawSales.length}건 · {fmtKrw(total)}
          </span>
        </div>
        <PrintButton />
      </div>

      {/* 거래명세표 본체 */}
      <section className="bg-zinc-100 px-4 py-6 dark:bg-zinc-900 print:bg-white print:p-0">
        <div className="mx-auto max-w-[800px] rounded-md bg-white p-6 text-zinc-900 shadow-md print:max-w-none print:rounded-none print:p-0 print:shadow-none">
          <TradingStatement data={data} company={company} />
        </div>
      </section>
    </div>
  );
}
