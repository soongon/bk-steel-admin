import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";
import { buttonVariants } from "@/components/ui/button";
import { BookBadge } from "@/components/admin/book-badge";
import { PrintButton } from "@/components/admin/print-button";
import {
  type StatementData,
  type StatementLine,
} from "@/components/admin/trading-statement";
import { SiteStatementView } from "./statement-view";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { rebarSpecLabel } from "@/lib/rebar";
import { fmtKrw } from "@/lib/format";

type RawPartner = {
  id: string;
  code: string;
  name: string;
  business_no: string | null;
  representative: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  industry: string | null;
};
type RawLine = {
  qty: number | string;
  unit: string;
  unit_price_krw: number | string;
  weight_kg: number | string | null;
  theoretical_weight_kg: number | string | null;
  line_subtotal_krw: number | string | null;
  display_name: string | null;
  spec_text: string | null;
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
  book: Book;
  doc_no: string;
  ordered_on: string;
  subtotal_krw: number | string;
  vat_krw: number | string;
  total_krw: number | string;
  vat_rate: number | string | null;
  is_documented: boolean;
  notes: string | null;
  partner: RawPartner | null;
  sale_line: RawLine[];
};

const SALE_SELECT = `
  id, book, doc_no, ordered_on, delivered_on, status,
  subtotal_krw, vat_krw, total_krw, vat_rate, is_documented,
  tax_doc_no, notes,
  partner:partner(id, code, name, business_no, representative, address, phone, fax, industry),
  sale_line(
    id, qty, unit, unit_price_krw, weight_kg, theoretical_weight_kg, line_subtotal_krw,
    display_name, spec_text,
    item:item(id, name, category, rebar_spec_code, rebar_grade_code, length_m)
  )`;

/** sale_line → StatementLine — 단건 매출 상세와 동일 표기(철근 라벨·철제 직접입력·단가 환산·금액직접입력 '-'). */
function mapLine(l: RawLine, s: RawSale): StatementLine {
  const item = l.item;
  const isRebar = item?.category === "rebar" && !!item?.rebar_spec_code;
  let spec = "";
  if (isRebar) spec = rebarSpecLabel(item!);
  else if (l.spec_text) spec = String(l.spec_text); // 철제 직접입력 규격
  const subtotal = Number(l.line_subtotal_krw ?? Number(l.qty) * Number(l.unit_price_krw));
  const vatRate = Number(s.vat_rate ?? 10);
  const vat = s.is_documented ? Math.round((subtotal * vatRate) / 100) : 0;
  const q = Number(l.qty);
  const unitLabel = l.unit === "ton" ? "톤" : l.unit === "kg" ? "kg" : l.unit === "ea" ? "EA" : l.unit;
  return {
    item_name: l.display_name?.trim() || item?.name || "—",
    spec,
    is_rebar: isRebar,
    qty: q,
    unit: unitLabel,
    unit_price_krw:
      Number(l.unit_price_krw) === 0
        ? 0 // 금액 직접입력(단가 미입력) → 명세표에 '-'
        : isRebar
          ? Number(l.unit_price_krw)
          : q > 0
            ? Math.round(subtotal / q)
            : Number(l.unit_price_krw),
    subtotal_krw: subtotal,
    vat_krw: vat,
    weight_kg:
      l.theoretical_weight_kg != null
        ? Number(l.theoretical_weight_kg)
        : l.weight_kg != null
          ? Number(l.weight_kg)
          : null,
    display_name: l.display_name ?? null,
    ordered_on: s.ordered_on, // 누적 명세표 라인별 날짜
  };
}

/**
 * 현장 누적 거래명세표 — 날짜 오름차순 전 라인 나열.
 *  - ?partner=&book= 있으면: 그 (book, 거래처, 현장) 그룹 누적 (현장 상세의 그룹별 진입점).
 *  - 없으면: 현장 전체 매출 누적 (매출목록·현장목록에서 현장 클릭 진입).
 *    URL book 경로가 bk/sl/b 면 그 책만, all 이면 전체 책.
 */
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
  const groupMode = !!partnerId && !!groupBook;

  const supabase = await createClient();

  // 1. 현장
  const { data: site } = await supabase
    .from("site")
    .select("id, code, name, address, client_name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!site) notFound();

  // 2. 매출 + 거래처 + 라인 — 날짜 오름차순(같은 날은 전표번호순)
  let query = supabase
    .from("sale")
    .select(SALE_SELECT)
    .eq("site_id", id)
    .is("deleted_at", null)
    .order("ordered_on")
    .order("doc_no");
  if (groupMode) {
    query = query.eq("book", groupBook!).eq("partner_id", partnerId!);
  } else if (bookParam === "bk" || bookParam === "sl" || bookParam === "b") {
    query = query.eq("book", bookParam);
  }
  const { data: sales } = await query;
  const rawSales = (sales ?? []) as unknown as RawSale[];

  if (groupMode && rawSales.length === 0) notFound();

  // 3. 매출 없음(전체 모드) — 빈 안내
  if (rawSales.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between gap-4 border-b bg-card px-6 py-3">
          <Link href={`/${bookParam}/sites/${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ArrowLeftIcon className="size-4" />
            현장 상세
          </Link>
          <span className="text-sm">{site.name}</span>
          <span />
        </div>
        <div className="m-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          이 현장의 매출이 아직 없습니다.
        </div>
      </div>
    );
  }

  // 4. 공급받는자 — 그룹 모드는 그 거래처, 전체 모드는 거래처 1곳이면 그 정보·여럿이면 대표+N곳
  const uniqPartners = [...new Map(rawSales.filter((s) => s.partner).map((s) => [s.partner!.id, s.partner!])).values()];
  const mainPartner = groupMode ? (rawSales[0].partner ?? null) : (uniqPartners[0] ?? null);
  const partnerLabel =
    uniqPartners.length > 1 ? `${mainPartner?.name ?? "—"} 외 ${uniqPartners.length - 1}곳` : (mainPartner?.name ?? "—");

  // 5. 공급자 — 그룹 모드는 그 책. 전체 모드는 URL 책, all 이면 매출이 단일 책일 때 그 책·섞이면 SL(주 운영).
  const saleBooks = [...new Set(rawSales.map((s) => s.book))];
  const supplierBook: Book = groupMode
    ? groupBook!
    : bookParam === "bk" || bookParam === "sl" || bookParam === "b"
      ? bookParam
      : saleBooks.length === 1
        ? saleBooks[0]
        : "sl";
  const company = await fetchCompanyProfile(supabase, supplierBook);

  // 6. 합계·라인 (매출이 날짜 오름차순이라 라인도 오름차순)
  let subtotal = 0;
  let vat = 0;
  let total = 0;
  let anyUndocumented = false;
  const lines: StatementLine[] = [];
  for (const s of rawSales) {
    subtotal += Number(s.subtotal_krw);
    vat += Number(s.vat_krw);
    total += Number(s.total_krw);
    if (!s.is_documented) anyUndocumented = true;
    for (const l of s.sale_line) lines.push(mapLine(l, s));
  }

  const firstSale = rawSales[0];
  const lastSale = rawSales[rawSales.length - 1];
  const period =
    firstSale.ordered_on === lastSale.ordered_on
      ? firstSale.ordered_on
      : `${firstSale.ordered_on} ~ ${lastSale.ordered_on}`;

  const data: StatementData = {
    doc_no: groupMode
      ? `${site.code}/${mainPartner?.code ?? ""} (${rawSales.length}건)`
      : `${site.code} 누적 (${rawSales.length}건)`,
    ordered_on: firstSale.ordered_on,
    tax_doc_no: null,
    partner: {
      name: partnerLabel,
      business_no: uniqPartners.length === 1 || groupMode ? (mainPartner?.business_no ?? null) : null,
      representative: uniqPartners.length === 1 || groupMode ? (mainPartner?.representative ?? null) : null,
      address: uniqPartners.length === 1 || groupMode ? (mainPartner?.address ?? null) : null,
      phone: uniqPartners.length === 1 || groupMode ? (mainPartner?.phone ?? null) : null,
      fax: uniqPartners.length === 1 || groupMode ? (mainPartner?.fax ?? null) : null,
      industry: uniqPartners.length === 1 || groupMode ? (mainPartner?.industry ?? null) : null,
    },
    site_name: `${site.name} (${site.code})`,
    is_documented: !anyUndocumented,
    lines,
    subtotal_krw: subtotal,
    vat_krw: vat,
    total_krw: total,
    notes: groupMode
      ? `납품기간 ${period} · 매출 ${rawSales.length}건 [${rawSales.map((s) => s.doc_no).join(", ")}]`
      : `납품기간 ${period} · 매출 ${rawSales.length}건${uniqPartners.length > 1 ? ` · 거래처 ${uniqPartners.length}곳` : ""}`,
  };

  const badgeBook: Book | null = groupMode
    ? groupBook!
    : bookParam === "bk" || bookParam === "sl" || bookParam === "b"
      ? bookParam
      : saleBooks.length === 1
        ? saleBooks[0]
        : null;

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
            {groupMode ? `${mainPartner?.name ?? "—"} · ` : ""}
            {site.name}
          </span>
          {badgeBook ? <BookBadge book={badgeBook} /> : null}
          <span className="text-xs text-muted-foreground">
            누적 {rawSales.length}건 · {fmtKrw(total)}
          </span>
        </div>
        <PrintButton />
      </div>

      {/* 거래명세표 본체(공급받는자 보관용 1매) + 문자(MMS) 전송 */}
      <SiteStatementView
        data={data}
        company={company}
        siteId={site.id}
        book={supplierBook}
        defaultPhone={uniqPartners.length === 1 || groupMode ? (mainPartner?.phone ?? null) : null}
      />
    </div>
  );
}
