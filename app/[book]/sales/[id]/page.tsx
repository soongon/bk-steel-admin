import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon, FileTextIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";
import { buttonVariants } from "@/components/ui/button";
import { BookBadge } from "@/components/admin/book-badge";
import { type StatementData } from "@/components/admin/trading-statement";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { buildDeliveryCertData } from "@/lib/delivery-cert-builder";
import { type Attachment } from "@/lib/attachment";
import { AttachmentGallery } from "@/components/admin/attachments/attachment-gallery";
import { SaleLifecyclePanel } from "./sale-lifecycle-panel";
import { type BankAccount } from "../settle-dialog";
import { fmtKrw, fmtNum, formatBusinessNo, formatPhone } from "@/lib/format";
import { type LineDraft, type DraftItem, type DraftRebarSpec } from "@/lib/transaction-draft";
import { SaleLinesEditButton } from "./sale-lines-edit-button";

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
      statement_sent_on, tax_invoice_issued_on, source_quote_id,
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
  // 견적 출처(수주 전환) — source_quote_id 있으면 견적 doc_no 역참조해 링크 표기.
  let sourceQuote: { id: string; doc_no: string } | null = null;
  if ((sale as any).source_quote_id) {
    const { data: sq } = await supabase
      .from("quote")
      .select("id, doc_no")
      .eq("id", (sale as any).source_quote_id)
      .maybeSingle();
    sourceQuote = sq;
  }
  const partner = sale.partner as any;
  const site = (sale as any).site as { id: string; code: string; name: string } | null;
  const lines = (sale.sale_line ?? []) as any[];
  const receiveBank = (sale as any).receive_bank as { code: string; bank_name: string } | null;

  // 공급자(우리) 회사 정보 fetch
  const company = await fetchCompanyProfile(supabase, book);

  // 수금 통장 (매출 책) — 라이프사이클 패널 수금 단계용
  const { data: bankAccounts } = await supabase
    .from("bank_account")
    .select("id, code, bank_name, book, kind")
    .eq("book", book)
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("is_primary", { ascending: false });

  // 품목 수정 모달용 — 마스터(품목·규격)와 기존 라인을 LineDraft 로 변환.
  const [{ data: itemsData }, { data: rebarSpecsData }] = await Promise.all([
    supabase
      .from("item")
      .select("id, name, category, rebar_spec_code, rebar_grade_code, length_m, bars_per_tonne")
      .is("deleted_at", null)
      .eq("is_active", true),
    supabase.from("rebar_spec").select("spec_code, unit_weight_kg_per_m, standard_length_m"),
  ]);
  const editItems = (itemsData ?? []) as DraftItem[];
  const editRebarSpecs = (rebarSpecsData ?? []) as DraftRebarSpec[];
  const editLines: LineDraft[] = lines.map((line) => {
    const it = line.item as { id: string; category?: string; rebar_spec_code?: string | null } | null;
    const isReb = it?.category === "rebar" || !!it?.rebar_spec_code;
    const u = line.unit;
    return {
      itemKind: isReb ? "rebar" : "steel",
      itemId: it?.id ?? "",
      unit: u === "ton" || u === "kg" ? u : "ea",
      qty: Number(line.qty),
      unitPrice: Number(line.unit_price_krw),
      tonMetric: false,
    };
  });

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
      // 수량·단위는 저장된 입력 그대로(톤이면 톤). 단가는 입력단위당으로 환산해 수량×단가=공급가 정합.
      const q = Number(line.qty);
      const unitLabel =
        line.unit === "ton" ? "톤" : line.unit === "kg" ? "kg" : line.unit === "ea" ? "EA" : line.unit;
      return {
        item_name: item?.name ?? "—",
        spec,
        qty: q,
        unit: unitLabel,
        unit_price_krw: q > 0 ? Math.round(subtotal / q) : Number(line.unit_price_krw),
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
    <div className="flex flex-1 flex-col gap-4 p-6">
      {/* 액션 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/${bookParam}/sales`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeftIcon className="size-4" />
            목록
          </Link>
          <span className="ml-1 font-mono text-sm font-medium">{sale.doc_no}</span>
          <BookBadge book={book} />
          <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-xs">
            {STATUS_KO[sale.status] ?? sale.status}
          </span>
          {(() => {
            const pay = paymentBadge(sale.status, sale.settled_on, sale.payment_due_on);
            return pay ? (
              <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${pay.className}`}>
                {pay.label}
              </span>
            ) : null;
          })()}
          {!sale.is_documented ? (
            <span className="inline-flex h-5 items-center rounded-full bg-amber-100 px-2 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              무자료
            </span>
          ) : null}
          {sourceQuote ? (
            <Link
              href={`/${book}/quotes/${sourceQuote.id}`}
              className="inline-flex h-5 items-center gap-1 rounded-full bg-blue-50 px-2 text-xs text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"
              title="이 매출의 견적 출처"
            >
              <FileTextIcon className="size-3" /> 견적 {sourceQuote.doc_no}
            </Link>
          ) : null}
        </div>
        {sale.status !== "settled" && sale.status !== "cancelled" ? (
          <SaleLinesEditButton
            saleId={sale.id}
            initialLines={editLines}
            items={editItems}
            rebarSpecs={editRebarSpecs}
          />
        ) : null}
      </div>

      {/* 거래 라이프사이클 (주문→납품→명세표→계산서→수금→확인서) */}
      <SaleLifecyclePanel
        sale={{
          id: sale.id,
          doc_no: sale.doc_no,
          book,
          status: sale.status,
          ordered_on: sale.ordered_on,
          delivered_on: sale.delivered_on,
          settled_on: sale.settled_on,
          payment_due_on: sale.payment_due_on,
          delivery_cert_id: sale.delivery_cert_id,
          statement_sent_on: (sale as { statement_sent_on: string | null }).statement_sent_on ?? null,
          tax_invoice_issued_on: (sale as { tax_invoice_issued_on: string | null }).tax_invoice_issued_on ?? null,
          is_documented: sale.is_documented,
          tax_doc_type: sale.tax_doc_type,
          total_krw: Number(sale.total_krw),
          partner_id: sale.partner_id,
          site_id: sale.site_id,
        }}
        bankAccounts={(bankAccounts ?? []) as BankAccount[]}
        company={company}
        statementData={statementData}
        cert={cert}
        certFormData={certFormData}
      />

      {/* 정보 카드 그리드 */}
      <section className="grid gap-4 md:grid-cols-3">
        <InfoCard label="거래처">
          <div className="text-base font-semibold">{partner?.name ?? "—"}</div>
          <dl className="mt-2 space-y-1 text-xs">
            {partner?.business_no ? <Row k="사업자" v={formatBusinessNo(partner.business_no)} /> : null}
            {partner?.representative ? <Row k="대표" v={partner.representative} /> : null}
            {partner?.phone ? <Row k="연락처" v={formatPhone(partner.phone)} /> : null}
            {partner?.address ? <Row k="주소" v={partner.address} /> : null}
            <Row
              k="현장"
              v={
                site?.id ? (
                  <Link href={`/${bookParam}/sites/${site.id}`} className="hover:underline">
                    {site.name}
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">{site.code}</span>
                  </Link>
                ) : (
                  (sale.site_name ?? "—")
                )
              }
            />
          </dl>
        </InfoCard>

        <InfoCard label="거래·일정">
          <dl className="space-y-1.5 text-xs">
            <Row k="주문일" v={<span className="font-mono">{sale.ordered_on}</span>} />
            <Row
              k="납품일"
              v={
                sale.delivered_on ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono">{sale.delivered_on}</span>
                    {(() => {
                      const d = deliveryDayBadge(sale.delivered_on, sale.status);
                      return d ? (
                        <span className={`inline-flex h-4 items-center rounded px-1 text-[10px] font-medium ${d.className}`}>
                          {d.label}
                        </span>
                      ) : null;
                    })()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">미정</span>
                )
              }
            />
            {sale.payment_due_on ? <Row k="수금예정" v={<span className="font-mono">{sale.payment_due_on}</span>} /> : null}
            {sale.settled_on ? <Row k="수금완료" v={<span className="font-mono">{sale.settled_on}</span>} /> : null}
            <Row
              k="자료"
              v={`${TAX_DOC_KO[sale.tax_doc_type] ?? sale.tax_doc_type}${sale.tax_doc_no ? ` · ${sale.tax_doc_no}` : ""}`}
            />
            {receiveBank ? <Row k="입금통장" v={`${receiveBank.code} · ${receiveBank.bank_name}`} /> : null}
          </dl>
        </InfoCard>

        <InfoCard label="금액">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">공급가</dt>
              <dd className="tabular-nums">{fmtKrw(Number(sale.subtotal_krw))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">부가세</dt>
              <dd className="tabular-nums">{fmtKrw(Number(sale.vat_krw))}</dd>
            </div>
            <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
              <dt>합계</dt>
              <dd className="tabular-nums">{fmtKrw(Number(sale.total_krw))}</dd>
            </div>
          </dl>
        </InfoCard>
      </section>

      {/* 품목 테이블 (멀티라인) */}
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-4 py-2 text-sm font-medium">품목 ({statementData.lines.length}건)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">품목</th>
                <th className="px-2 py-2 text-left font-medium">규격</th>
                <th className="px-2 py-2 text-right font-medium">수량</th>
                <th className="px-2 py-2 text-right font-medium">단가</th>
                <th className="px-2 py-2 text-right font-medium">공급가</th>
                <th className="px-2 py-2 text-right font-medium">세액</th>
                <th className="px-4 py-2 text-right font-medium">중량</th>
              </tr>
            </thead>
            <tbody>
              {statementData.lines.map((l, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-2 font-medium">{l.item_name}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{l.spec}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {l.qty.toLocaleString()} {l.unit}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtKrw(l.unit_price_krw)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtKrw(l.subtotal_krw)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{fmtKrw(l.vat_krw)}</td>
                  <td className="px-4 py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {l.weight_kg ? `${fmtNum(l.weight_kg)}kg` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-medium">
                <td className="px-4 py-2" colSpan={4}>합계</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtKrw(Number(sale.subtotal_krw))}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtKrw(Number(sale.vat_krw))}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtKrw(Number(sale.total_krw))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* 메모 */}
      {sale.notes ? (
        <section className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">메모</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{sale.notes}</p>
        </section>
      ) : null}

      {/* 첨부 사진 — 클릭 시 라이트박스 */}
      {attachments.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">첨부 사진 ({attachments.length}장)</h2>
          <AttachmentGallery attachments={attachments} variant="square" />
        </section>
      ) : null}
    </div>
  );
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-14 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 flex-1">{v}</dd>
    </div>
  );
}
