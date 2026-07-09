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
import { QuoteConvertButton } from "./quote-convert-button";
import { QuoteEditButton } from "./quote-edit-button";
import {
  type QuoteSources,
  type EditingQuote,
  type QuotePartner,
  type QuoteItem,
  type QuoteRebarSpec,
} from "@/components/admin/quote-dialog";
import { type LineDraft } from "@/lib/transaction-draft";

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

  const [companyRes, partnersRes, itemsRes, rebarSpecsRes] = await Promise.all([
    supabase.from("company_profile").select("*").eq("book", q.book).maybeSingle(),
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
  ]);
  const company = (companyRes.data ?? null) as CompanyProfile | null;
  const partners = (partnersRes.data ?? []) as QuotePartner[];

  // 수주 전환된 매출(있으면) — 견적→매출 정방향 링크.
  let convertedSale: { id: string; doc_no: string } | null = null;
  if (q.status === "won") {
    const { data: cs } = await supabase
      .from("sale")
      .select("id, doc_no")
      .eq("source_quote_id", id)
      .is("deleted_at", null)
      .maybeSingle();
    convertedSale = cs;
  }

  const lines = (q.lines ?? []) as Record<string, any>[];
  const vatRate = Number(q.vat_rate);

  // 견적 수정(QuoteDialog 편집 모드)용 소스 + 프리필
  const editSources: QuoteSources = {
    partners,
    items: (itemsRes.data ?? []) as QuoteItem[],
    rebarSpecs: (rebarSpecsRes.data ?? []) as QuoteRebarSpec[],
    company,
  };
  const editingQuote: EditingQuote = {
    id: q.id,
    doc_no: q.doc_no,
    quote_date: q.quote_date,
    valid_until: q.valid_until ?? null,
    partner_id: q.partner_id ?? null,
    partner_name: q.partner?.name ?? q.prospect_name ?? "",
    site_name: q.site_name ?? null,
    is_documented: q.is_documented,
    delivery_terms: q.delivery_terms ?? null,
    payment_terms: q.payment_terms ?? null,
    notes: q.notes ?? null,
    lines: lines.map((l) => {
      const it = l.item as Record<string, any> | null;
      const isReb = !!it?.rebar_spec_code;
      const u = String(l.unit);
      const w = l.weight_kg != null ? Number(l.weight_kg) : null;
      // 영구 저장된 ton_metric(0060) 우선, 없으면(구 데이터) weight_kg=qty×1000 추론 fallback.
      const isMetricTon =
        l.ton_metric === true ||
        (u === "ton" && w != null && Math.round(w) === Math.round(Number(l.qty) * 1000));
      return {
        itemKind: isReb ? "rebar" : "steel",
        itemId: String(l.item_id),
        unit: u === "ton" || u === "kg" ? u : "ea",
        qty: Number(l.qty),
        unitPrice: Number(l.unit_price_krw),
        tonMetric: isMetricTon,
        manualAmount: l.manual_amount != null ? Number(l.manual_amount) : null,
        displayName: l.display_name != null ? String(l.display_name) : null,
        specText: l.spec_text != null ? String(l.spec_text) : null,
      } as LineDraft;
    }),
  };

  const stLines = lines.map((l) => {
    const item = l.item as Record<string, any> | null;
    const isReb = !!item?.rebar_spec_code;
    const spec = isReb
      ? [item!.rebar_spec_code, item!.rebar_grade_code, item!.length_m ? `${item!.length_m}M` : null]
          .filter(Boolean)
          .join(" ")
      : l.spec_text ? String(l.spec_text) : ""; // 철제 직접입력 규격
    const unitLabel = l.unit === "ton" ? "톤" : l.unit === "kg" ? "kg" : "EA";
    const sub = Number(l.line_subtotal_krw);
    return {
      item_name: l.display_name?.trim() || item?.name || "—",
      spec,
      is_rebar: isReb,
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
        <div className="flex flex-wrap items-center gap-2">
          <BookBadge book={q.book} size="md" />
          <QuoteEditButton book={q.book} sources={editSources} editing={editingQuote} />
          <QuoteConvertButton
            quoteId={q.id}
            book={q.book}
            status={q.status}
            saleId={convertedSale?.id ?? null}
            saleDocNo={convertedSale?.doc_no ?? null}
            partnerName={q.partner?.name ?? null}
            partners={partners}
            isDocumented={q.is_documented}
          />
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
                <TableCell className="text-right tabular-nums">
                  {Number(l.unit_price_krw) > 0 ? fmtKrw(l.unit_price_krw) : "-"}
                </TableCell>
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
