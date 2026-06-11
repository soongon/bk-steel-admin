import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";
import { buttonVariants } from "@/components/ui/button";
import { BookBadge } from "@/components/admin/book-badge";
import { PrintButton } from "@/components/admin/print-button";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { buildDeliveryCertData } from "@/lib/delivery-cert-builder";
import { type Attachment } from "@/lib/attachment";
import { AttachmentGallery } from "@/components/admin/attachments/attachment-gallery";
import { DeliveryCertButton } from "./delivery-cert-button";

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

/** 납품일 D-day 뱃지 — 미래(예정)/오늘/지남 시각 구분. status가 이미 완료면 null. */
function deliveryDayBadge(deliveredOn: string, status: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const dDay = Math.round(
    (new Date(deliveredOn).getTime() - new Date(today).getTime()) / 86_400_000,
  );
  if (dDay > 0) {
    return {
      label: `D-${dDay}`,
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    };
  }
  if (dDay === 0) {
    return {
      label: "오늘",
      className: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    };
  }
  // 과거 — status가 delivered/settled면 이미 status 뱃지에서 표현되므로 생략
  if (status === "delivered" || status === "settled") return null;
  return {
    label: `D+${Math.abs(dDay)} 지남`,
    className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  };
}

/**
 * settled_on / payment_due_on 으로 수금 상태 derive (KST 기준).
 * status='settled'(수금완료) / 'overdue'(연체) 인 경우엔 status 뱃지가 이미 같은 의미를
 * 보여주므로 중복 방지 위해 null 반환.
 */
function paymentBadge(status: string, settledOn: string | null, dueOn: string | null) {
  if (status === "settled" || status === "overdue") return null;
  if (settledOn) {
    return {
      label: "수금완료",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    };
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  if (dueOn && dueOn < today) {
    return {
      label: "수금연체",
      className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
    };
  }
  if (dueOn) {
    return {
      label: "수금예정",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    };
  }
  return null;
}

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
      subtotal_krw, vat_krw, total_krw, vat_rate, site_name, site_id, partner_id, is_documented,
      tax_doc_type, tax_doc_no, payment_due_on, settled_on, notes, delivery_cert_id,
      partner:partner(id, code, name, business_no, representative, address, phone, fax, industry, email),
      site:site(id, code, name),
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
  const site = (sale as any).site as { id: string; code: string; name: string } | null;
  const lines = (sale.sale_line ?? []) as any[];

  // 공급자(우리) 회사 정보 fetch
  const company = await fetchCompanyProfile(supabase, book);

  // 첨부 사진 fetch
  const { data: attsData } = await supabase
    .from("attachment")
    .select(
      "id, entity_type, entity_id, kind, storage, path, url, thumbnail_url, mime, bytes, width, height, caption, sort_order, created_at",
    )
    .eq("entity_type", "sale")
    .eq("entity_id", id)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const attachments = (attsData ?? []) as Attachment[];

  // 납품확인서 양식 데이터 — site_id 가 있을 때만 누적 빌드 (동일 (book, partner, site) 의 모든 매출)
  const certFormData =
    sale.site_id && sale.partner_id
      ? await buildDeliveryCertData(supabase, book, sale.partner_id, sale.site_id)
      : null;
  const cert = certFormData?.cert ?? null;

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
      fax: partner?.fax ?? null,
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
          {(() => {
            const pay = paymentBadge(sale.status, sale.settled_on, sale.payment_due_on);
            if (!pay) return null;
            return (
              <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${pay.className}`}>
                {pay.label}
              </span>
            );
          })()}
          {!sale.is_documented ? (
            <span className="inline-flex h-5 items-center rounded-full bg-amber-100 px-2 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              무자료
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <DeliveryCertButton
            book={book}
            partnerId={sale.partner_id}
            siteId={sale.site_id}
            cert={cert}
            formData={certFormData}
            company={company}
          />
          <PrintButton />
        </div>
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
          <div className="text-sm">
            {site?.id ? (
              <Link href={`/${bookParam}/sites/${site.id}`} className="hover:underline">
                {site.name}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  {site.code}
                </span>
              </Link>
            ) : (
              (sale.site_name ?? "—")
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {TAX_DOC_KO[sale.tax_doc_type] ?? sale.tax_doc_type}
            {sale.tax_doc_no ? ` · ${sale.tax_doc_no}` : ""}
          </div>
        </MetaCard>
        <MetaCard label="일정">
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-8 text-muted-foreground">주문</span>
              <span className="font-mono">{sale.ordered_on}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-8 text-muted-foreground">납품</span>
              {sale.delivered_on ? (
                <>
                  <span className="font-mono">{sale.delivered_on}</span>
                  {(() => {
                    const d = deliveryDayBadge(sale.delivered_on, sale.status);
                    if (!d) return null;
                    return (
                      <span
                        className={`inline-flex h-4 items-center rounded px-1.5 text-[10px] font-medium ${d.className}`}
                      >
                        {d.label}
                      </span>
                    );
                  })()}
                </>
              ) : (
                <span className="text-muted-foreground">미정</span>
              )}
            </div>
            {sale.payment_due_on || sale.settled_on ? (
              <div className="text-muted-foreground">
                {sale.payment_due_on ? `수금예정 ${sale.payment_due_on}` : ""}
                {sale.settled_on ? ` · 완료 ${sale.settled_on}` : ""}
              </div>
            ) : null}
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

      {/* 첨부 사진 — 인쇄 시 숨김. 클릭 시 라이트박스 (←/→ 키보드 네비) */}
      {attachments.length > 0 ? (
        <section className="px-6 pb-4 print:hidden">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            첨부 사진 ({attachments.length}장)
          </h2>
          <AttachmentGallery attachments={attachments} variant="square" />
        </section>
      ) : null}

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
