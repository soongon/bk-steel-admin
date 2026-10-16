import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BookBadge } from "@/components/admin/book-badge";
import { fmtKrw } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type Book } from "@/lib/book";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { STEEL_CUSTOM_ITEM_ID } from "@/lib/transaction-draft";
import {
  PURCHASE_QUOTE_CARD_KIND,
  PURCHASE_QUOTE_STATUS_LABEL,
  type PurchaseQuoteStatus,
  perKgToPerTon,
  type PurchaseQuoteLineDraft,
} from "@/lib/purchase-quote";
import { type Attachment } from "@/lib/attachment";
import { type LeadSource, isLeadSource } from "@/lib/lead-source";
import { LeadSourceBadge } from "@/components/admin/lead-source-badge";
import { PurchaseQuoteCardPanel } from "@/components/admin/purchase-quote-cards";
import { type PurchaseQuoteDocumentData } from "@/components/admin/purchase-quote-document";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type PurchaseQuoteSources,
  type EditingPurchaseQuote,
  type PurchaseQuotePartner,
  type PurchaseQuoteItemOption,
} from "@/components/admin/purchase-quote-dialog";
import { PurchaseQuoteDetailActions } from "./purchase-quote-detail-actions";
import { PurchaseQuoteEditButton } from "./purchase-quote-edit-button";

type PurchaseQuoteRow = {
  id: string;
  book: Book;
  doc_no: string;
  quote_date: string;
  valid_until: string | null;
  partner_id: string | null;
  prospect_name: string | null;
  site_name: string | null;
  is_documented: boolean;
  weighing_terms: string | null;
  delivery_terms: string | null;
  payment_terms: string | null;
  notes: string | null;
  lead_source: string | null;
  lead_note: string | null;
  status: PurchaseQuoteStatus;
  sent_on: string | null;
  mms_sent_on: string | null;
  partner: { name: string; representative: string | null; phone: string | null; address: string | null } | null;
  lines: Array<{
    item_id: string | null;
    display_name: string;
    spec_text: string | null;
    price_per_kg_krw: number | string;
    notes: string | null;
    sort_order: number;
  }>;
};

export default async function PurchaseQuoteDetailPage({ params }: { params: Promise<{ book: string; id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("purchase_quote")
    .select("*, partner:partner(*), lines:purchase_quote_line(*)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) notFound();
  // 단일 FK 조인은 런타임에 object — 타입 추론(배열) 우회.
  const q = data as unknown as PurchaseQuoteRow;
  const book = q.book;

  const [company, partnersRes, itemsRes, cardsRes] = await Promise.all([
    fetchCompanyProfile(supabase, book),
    supabase.from("partner").select("id, name, representative, address, phone").is("deleted_at", null).eq("is_active", true).order("name"),
    supabase.from("item").select("id, name").is("deleted_at", null).eq("is_active", true).neq("id", STEEL_CUSTOM_ITEM_ID).order("name"),
    // 판매자 명함(첨부, 0077)
    supabase
      .from("attachment")
      .select("id, entity_type, entity_id, kind, storage, path, url, thumbnail_url, mime, bytes, width, height, caption, sort_order, created_at")
      .eq("entity_type", "purchase_quote")
      .eq("entity_id", id)
      .eq("kind", PURCHASE_QUOTE_CARD_KIND)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  const cards = (cardsRes.data ?? []) as Attachment[];

  const lines = [...(q.lines ?? [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const partnerName: string = q.partner?.name ?? q.prospect_name ?? "";

  const editSources: PurchaseQuoteSources = {
    partners: (partnersRes.data ?? []) as PurchaseQuotePartner[],
    items: (itemsRes.data ?? []) as PurchaseQuoteItemOption[],
    company,
  };
  const editing: EditingPurchaseQuote = {
    id: q.id,
    doc_no: q.doc_no,
    quote_date: q.quote_date,
    valid_until: q.valid_until ?? null,
    partner_id: q.partner_id ?? null,
    partner_name: partnerName,
    site_name: q.site_name ?? null,
    is_documented: q.is_documented,
    weighing_terms: q.weighing_terms ?? null,
    delivery_terms: q.delivery_terms ?? null,
    payment_terms: q.payment_terms ?? null,
    notes: q.notes ?? null,
    lead_source: isLeadSource(q.lead_source) ? (q.lead_source as LeadSource) : null,
    lead_note: q.lead_note ?? null,
    cards,
    lines: lines.map(
      (l): PurchaseQuoteLineDraft => ({
        itemId: l.item_id ?? null,
        displayName: String(l.display_name),
        specText: l.spec_text ?? null,
        pricePerKg: Number(l.price_per_kg_krw),
        notes: l.notes ?? null,
      }),
    ),
  };

  const docData: PurchaseQuoteDocumentData = {
    doc_no: q.doc_no,
    quote_date: q.quote_date,
    valid_until: q.valid_until ?? null,
    partner: {
      name: partnerName,
      representative: q.partner?.representative ?? null,
      phone: q.partner?.phone ?? null,
      address: q.partner?.address ?? null,
    },
    site_name: q.site_name ?? null,
    is_documented: q.is_documented,
    lines: lines.map((l) => ({
      name: String(l.display_name),
      spec: l.spec_text ?? null,
      price_per_kg: Number(l.price_per_kg_krw),
      note: l.notes ?? null,
    })),
    weighing_terms: q.weighing_terms ?? null,
    delivery_terms: q.delivery_terms ?? null,
    payment_terms: q.payment_terms ?? null,
    notes: q.notes ?? null,
  };

  const status = q.status as PurchaseQuoteStatus;
  const st = PURCHASE_QUOTE_STATUS_LABEL[status] ?? { label: status, cls: "" };

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="text-sm text-muted-foreground">
        <Link href={`/${book}/purchase-quotes`} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> 매입견적서 목록
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-xl font-semibold">{q.doc_no}</h1>
            <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${st.cls}`}>{st.label}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {partnerName || "판매자 미지정"}
            {q.site_name ? ` · ${q.site_name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BookBadge book={book} size="md" />
          {status !== "done" ? <PurchaseQuoteEditButton book={book} sources={editSources} editing={editing} /> : null}
          <PurchaseQuoteDetailActions quoteId={q.id} book={book} status={status} docData={docData} company={company} />
        </div>
      </header>

      {/* 명함이 있으면 오른쪽(모바일은 맨 위)에 크게 — 판매자 확인용 참고 정보 */}
      <div
        className={cn(
          "grid items-start gap-6",
          cards.length > 0 && "lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]",
        )}
      >
        {cards.length > 0 ? (
          <aside className="lg:sticky lg:top-6 lg:order-last">
            <PurchaseQuoteCardPanel cards={cards} sellerName={partnerName} />
          </aside>
        ) : null}
        <div className="flex min-w-0 flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Info label="견적일" value={q.quote_date} />
            <Info label="유효기간" value={q.valid_until ?? "—"} />
            <Info label="부가세" value={q.is_documented ? "별도 (자료)" : "무자료"} />
            <Info label="발송" value={q.mms_sent_on ? `문자 ${q.mms_sent_on}` : q.sent_on ? `발송 ${q.sent_on}` : "—"} />
            <div>
              <div className="text-xs text-muted-foreground">유입경로</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-sm">
                <LeadSourceBadge source={q.lead_source} note={q.lead_note} />
                {q.lead_note ? <span className="text-xs text-muted-foreground">{q.lead_note}</span> : null}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>품목</TableHead>
                  <TableHead>규격 · 상태</TableHead>
                  <TableHead className="text-right">단가 (원/kg)</TableHead>
                  <TableHead className="text-right">환산 (원/톤)</TableHead>
                  <TableHead>비고</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docData.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.spec || "—"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtKrw(l.price_per_kg)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtKrw(perKgToPerTon(l.price_per_kg))}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.note || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            총중량·매입금액은 당일 계근 후 확정 — 계근이 끝나면 <Link href={`/${book}/purchases`} className="underline">매입</Link> 메뉴에서 kg 단위·실중량으로 등록하고, 이 견적은 ‘매입 완료’로 표시하세요.
          </p>

          {q.weighing_terms || q.delivery_terms || q.payment_terms || q.notes ? (
            <div className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
              {q.weighing_terms ? <Info label="계근 조건" value={q.weighing_terms} /> : null}
              {q.delivery_terms ? <Info label="운반·상하차" value={q.delivery_terms} /> : null}
              {q.payment_terms ? <Info label="결제조건" value={q.payment_terms} /> : null}
              {q.notes ? <Info label="메모" value={q.notes} /> : null}
            </div>
          ) : null}
        </div>
      </div>
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
