import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { buttonVariants } from "@/components/ui/button";
import { BookBadge } from "@/components/admin/book-badge";
import { PrintButton } from "@/components/admin/print-button";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { fetchCompanyProfile } from "@/lib/company-profile";

const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

const STATUS_KO: Record<string, string> = {
  reserved: "주문",
  confirmed: "확정",
  delivered: "납품완료",
  settled: "수금완료",
  overdue: "연체",
  cancelled: "취소",
};

const TAX_DOC_KO: Record<string, string> = {
  tax_invoice_electronic: "전자세금계산서",
  tax_invoice_paper: "종이세금계산서",
  invoice: "계산서(면세)",
  cash_receipt: "현금영수증",
  simple_receipt: "간이영수증",
  none: "무자료",
};

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ book: string; id: string }>;
}) {
  const { book: bookParam, id } = await params;
  const supabase = await createClient();

  const { data: sale, error } = await supabase
    .from("sale")
    .select(
      `
      id, book, doc_no, ordered_on, delivered_on, status,
      subtotal_krw, vat_krw, total_krw, vat_rate, site_name, is_documented,
      tax_doc_type, tax_doc_no, payment_due_on, settled_on, notes,
      partner:partner(id, code, name, business_no, representative, address, phone, industry, email),
      receive_bank_account_id, receive_bank:bank_account!sale_receive_bank_account_id_fkey(code, bank_name),
      sale_line(
        id, qty, unit, unit_price_krw, weight_kg, theoretical_weight_kg, line_subtotal_krw, notes,
        item:item(id, name, code, rebar_spec_code, rebar_grade_code, length_m, category)
      )
    `,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !sale) notFound();

  const book = sale.book as Book;
  const partner = sale.partner as any;
  const lines = (sale.sale_line ?? []) as any[];

  // 공급자(우리) 회사 정보 fetch
  const company = await fetchCompanyProfile(supabase, book);

  // StatementData 구성
  const statementData: StatementData = {
    doc_no: sale.doc_no,
    ordered_on: sale.ordered_on,
    tax_doc_no: sale.tax_doc_no ?? null,
    partner: {
      name: partner?.name ?? "",
      business_no: partner?.business_no ?? null,
      representative: partner?.representative ?? null,
      address: partner?.address ?? null,
      phone: partner?.phone ?? null,
      industry: partner?.industry ?? null,
    },
    site_name: sale.site_name,
    is_documented: sale.is_documented,
    lines: lines.map((line) => {
      const item = line.item;
      let spec = "";
      if (item?.category === "rebar" && item?.rebar_spec_code) {
        spec = [
          item.rebar_spec_code,
          item.rebar_grade_code,
          item.length_m ? `${item.length_m}M` : null,
        ]
          .filter(Boolean)
          .join(" ");
      }
      const subtotal = Number(line.line_subtotal_krw ?? line.qty * line.unit_price_krw);
      const vatRate = Number(sale.vat_rate ?? 10);
      const vat = sale.is_documented ? Math.round((subtotal * vatRate) / 100) : 0;
      return {
        item_name: item?.name ?? "—",
        spec,
        qty: Number(line.qty),
        unit: line.unit,
        unit_price_krw: Number(line.unit_price_krw),
        subtotal_krw: subtotal,
        vat_krw: vat,
        weight_kg: line.theoretical_weight_kg ?? line.weight_kg,
        note: line.notes ?? undefined,
      };
    }),
    subtotal_krw: Number(sale.subtotal_krw),
    vat_krw: Number(sale.vat_krw),
    total_krw: Number(sale.total_krw),
    notes: sale.notes,
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* 상단 액션 바 — 인쇄 시 숨김 */}
      <div className="flex items-center justify-between gap-4 border-b bg-card px-6 py-3 print:hidden">
        <Link
          href={`/${bookParam}/sales`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeftIcon className="size-4" />
          매출 목록
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{sale.doc_no}</span>
          <BookBadge book={book} />
          <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-xs">
            {STATUS_KO[sale.status] ?? sale.status}
          </span>
        </div>
        <PrintButton />
      </div>

      {/* 상단 메타 정보 — 인쇄 시 숨김 */}
      <section className="grid grid-cols-2 gap-4 px-6 py-4 print:hidden md:grid-cols-4">
        <MetaCard label="거래처">
          <div className="text-sm font-medium">{partner?.name ?? "—"}</div>
          {partner?.business_no ? (
            <div className="text-xs text-muted-foreground">{partner.business_no}</div>
          ) : null}
        </MetaCard>
        <MetaCard label="현장 / 자료">
          <div className="text-sm">{sale.site_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">
            {TAX_DOC_KO[sale.tax_doc_type] ?? sale.tax_doc_type}
            {sale.tax_doc_no ? ` · ${sale.tax_doc_no}` : ""}
          </div>
        </MetaCard>
        <MetaCard label="일정">
          <div className="text-xs">
            주문 {sale.ordered_on}
            {sale.delivered_on ? ` / 납품 ${sale.delivered_on}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">
            {sale.payment_due_on ? `수금예정 ${sale.payment_due_on}` : ""}
            {sale.settled_on ? ` · 수금완료 ${sale.settled_on}` : ""}
          </div>
        </MetaCard>
        <MetaCard label="금액">
          <div className="text-sm tabular-nums">
            공급 {fmtKrw(Number(sale.subtotal_krw))}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            VAT {fmtKrw(Number(sale.vat_krw))} · 합계{" "}
            <span className="font-medium text-foreground">{fmtKrw(Number(sale.total_krw))}</span>
          </div>
        </MetaCard>
      </section>

      {/* 거래명세표 본체 — A4 폭(약 800px)으로 제한, 종이 느낌. 인쇄 시 풀-블리드 */}
      <section className="bg-zinc-100 px-4 py-6 dark:bg-zinc-900 print:bg-white print:p-0">
        <div className="mx-auto max-w-[800px] rounded-md bg-white p-6 text-zinc-900 shadow-md print:max-w-none print:rounded-none print:p-0 print:shadow-none">
          <TradingStatement data={statementData} company={company} />
        </div>
      </section>
    </div>
  );
}

function MetaCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
