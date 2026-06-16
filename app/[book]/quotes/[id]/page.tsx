import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BookBadge } from "@/components/admin/book-badge";
import { fmtKrw, fmtNum } from "@/lib/format";
import { type QuoteDocumentData } from "@/components/admin/quote-document";
import { type CompanyProfile } from "@/lib/company-profile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QuoteDetailActions } from "./quote-detail-actions";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: "작성", cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
  sent: { label: "발송", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  won: { label: "수주", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  expired: { label: "만료", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
};

export default async function QuoteDetailPage({ params }: { params: Promise<{ book: string; id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("quote")
    .select("*, partner:partner(*), lines:quote_line(*, item:item(name, rebar_spec_code, rebar_grade_code, length_m))")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  // 단일 FK 조인은 런타임에 object — 타입 추론(배열) 우회.
  const q = data as unknown as Record<string, any>;

  const companyRes = await supabase.from("company_profile").select("*").eq("book", q.book).maybeSingle();
  const company = (companyRes.data ?? null) as CompanyProfile | null;

  const lines = (q.lines ?? []) as Record<string, any>[];
  const vatRate = Number(q.vat_rate);

  const stLines = lines.map((l) => {
    const item = l.item as Record<string, any> | null;
    const isReb = !!item?.rebar_spec_code;
    const spec = isReb
      ? [item!.rebar_spec_code, item!.rebar_grade_code, item!.length_m ? `${item!.length_m}M` : null]
          .filter(Boolean)
          .join(" ")
      : "";
    const unitLabel = l.unit === "ton" ? "톤" : l.unit === "kg" ? "kg" : "EA";
    const sub = Number(l.line_subtotal_krw);
    return {
      item_name: item?.name ?? "—",
      spec,
      qty: Number(l.qty),
      unit: unitLabel,
      unit_price_krw: Number(l.unit_price_krw),
      subtotal_krw: sub,
      vat_krw: Math.round((sub * vatRate) / 100),
      weight_kg: l.weight_kg != null ? Number(l.weight_kg) : null,
    };
  });

  const statementData: QuoteDocumentData = {
    doc_no: q.doc_no,
    ordered_on: q.quote_date,
    tax_doc_no: null,
    partner: {
      name: q.partner?.name ?? q.prospect_name ?? "",
      business_no: q.partner?.business_no ?? null,
      representative: q.partner?.representative ?? null,
      address: q.partner?.address ?? null,
      phone: q.partner?.phone ?? null,
      fax: q.partner?.fax ?? null,
      industry: q.partner?.industry ?? null,
    },
    site_name: q.site_name,
    is_documented: q.is_documented,
    lines: stLines,
    subtotal_krw: Number(q.subtotal_krw),
    vat_krw: Number(q.vat_krw),
    total_krw: Number(q.total_krw),
    notes: q.notes,
    valid_until: q.valid_until,
    delivery_terms: q.delivery_terms,
    payment_terms: q.payment_terms,
  };

  const st = STATUS_LABEL[q.status] ?? { label: q.status, cls: "" };

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="text-sm text-muted-foreground">
        <Link href={`/${q.book}/quotes`} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> 견적서 목록
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-xl font-semibold">{q.doc_no}</h1>
            <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${st.cls}`}>{st.label}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {q.partner?.name ?? q.prospect_name ?? "거래처 미지정"}
            {q.site_name ? ` · ${q.site_name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BookBadge book={q.book} size="md" />
          <QuoteDetailActions
            quoteId={q.id}
            book={q.book}
            status={q.status}
            statementData={statementData}
            company={company}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Info label="견적일" value={q.quote_date} />
        <Info label="유효기간" value={q.valid_until ?? "—"} />
        <Info label="부가세" value={q.is_documented ? "포함 (10%)" : "제외 (무자료)"} />
        <Info label="합계" value={fmtKrw(Number(q.total_krw))} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>품목</TableHead>
              <TableHead>규격</TableHead>
              <TableHead className="text-right">수량</TableHead>
              <TableHead className="text-right">중량</TableHead>
              <TableHead className="text-right">단가</TableHead>
              <TableHead className="text-right">공급가</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stLines.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{l.item_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{l.spec || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtNum(l.qty)} {l.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.weight_kg != null ? `${fmtNum(l.weight_kg)}kg` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtKrw(l.unit_price_krw)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtKrw(l.subtotal_krw)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="ml-auto w-full max-w-xs rounded-md bg-muted/50 px-3 py-2 text-sm">
        <Row label="공급가" value={fmtKrw(Number(q.subtotal_krw))} />
        <Row label={`부가세 (${q.is_documented ? "10" : "0"}%)`} value={fmtKrw(Number(q.vat_krw))} />
        <div className="mt-1 border-t pt-1">
          <Row label="합계" value={fmtKrw(Number(q.total_krw))} strong />
        </div>
      </div>

      {q.delivery_terms || q.payment_terms || q.notes ? (
        <div className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
          {q.delivery_terms ? <Info label="납품조건" value={q.delivery_terms} /> : null}
          {q.payment_terms ? <Info label="결제조건" value={q.payment_terms} /> : null}
          {q.notes ? <Info label="메모" value={q.notes} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>{value}</span>
    </div>
  );
}
