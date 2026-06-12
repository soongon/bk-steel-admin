import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";
import { buttonVariants } from "@/components/ui/button";
import { BookBadge } from "@/components/admin/book-badge";
import { type Attachment } from "@/lib/attachment";
import { AttachmentGallery } from "@/components/admin/attachments/attachment-gallery";
import { fmtKrw, formatBusinessNo } from "@/lib/format";

const fmtNum = (n: number, d = 0) =>
  n.toLocaleString("ko-KR", { maximumFractionDigits: d });

// purchase_status enum (0002) — purchase-table 의 STATUS_LABEL 라벨과 일치
const STATUS_KO: Record<string, string> = {
  ordered: "발주",
  in_stock: "입고완료",
  partial_out: "일부 출고",
  depleted: "전량 출고",
  transferred_out: "이관",
  scrapped: "폐기",
};

/** 입고일 D-day 뱃지 — 미래(예정)/오늘/지남 시각 구분. status가 입고완료 이상이면 null. */
function arrivalDayBadge(deliveredOn: string, status: string) {
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
  // 과거 — status='ordered'(미입고) 일 때만 지남 경고. 나머지는 이미 입고됨.
  if (status !== "ordered") return null;
  return {
    label: `D+${Math.abs(dDay)} 지남`,
    className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  };
}

/**
 * paid_on / payment_due_on 으로 결제 상태 derive (KST 기준).
 * 매출 paymentBadge 와 시그니처 통일. 현재 purchase_status enum 은
 * 재고 흐름(ordered/in_stock/depleted/...)이라 결제 라벨과 중복 없으나,
 * 추후 'paid' 등 결제 의미 담은 status 추가 시 PAYMENT_REDUNDANT_STATUS 에 추가.
 */
const PAYMENT_REDUNDANT_STATUS = new Set<string>([]);
function paymentBadge(status: string, paidOn: string | null, dueOn: string | null) {
  if (PAYMENT_REDUNDANT_STATUS.has(status)) return null;
  if (paidOn) {
    return {
      label: "결제완료",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    };
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  if (dueOn && dueOn < today) {
    return {
      label: "결제연체",
      className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
    };
  }
  if (dueOn) {
    return {
      label: "결제예정",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    };
  }
  return null;
}

const TAX_DOC_KO: Record<string, string> = {
  tax_invoice_electronic: "전자세금계산서",
  tax_invoice_paper: "종이세금계산서",
  invoice: "계산서(면세)",
  cash_receipt: "현금영수증",
  simple_receipt: "간이영수증",
  none: "무자료",
};

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ book: string; id: string }>;
}) {
  const { book: bookParam, id } = await params;
  const supabase = await createClient();

  const { data: purchase, error } = await supabase
    .from("purchase")
    .select(
      `
      id, book, doc_no, ordered_on, delivered_on, paid_on, payment_due_on, status,
      subtotal_krw, vat_krw, total_krw, vat_rate, partner_id, is_documented,
      tax_doc_type, tax_doc_no, notes,
      partner:partner(id, code, name, business_no, representative, address, phone, fax, industry, email),
      purchase_line(
        id, acquired_qty, acquired_unit, unit_price_krw, line_subtotal_krw,
        actual_weight_kg, theoretical_weight_kg, notes,
        item:item(id, name, code, rebar_spec_code, rebar_grade_code, length_m, category)
      )
    `,
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !purchase) notFound();

  const book = purchase.book as Book;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const partner = purchase.partner as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines = (purchase.purchase_line ?? []) as any[];

  // 첨부 사진 fetch
  const { data: attsData } = await supabase
    .from("attachment")
    .select(
      "id, entity_type, entity_id, kind, storage, path, url, thumbnail_url, mime, bytes, width, height, caption, sort_order, created_at",
    )
    .eq("entity_type", "purchase")
    .eq("entity_id", id)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const attachments = (attsData ?? []) as Attachment[];

  return (
    <div className="flex flex-1 flex-col">
      {/* 상단 액션 바 */}
      <div className="flex items-center justify-between gap-4 border-b bg-card px-6 py-3">
        <Link
          href={`/${bookParam}/purchases`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeftIcon className="size-4" />
          매입 목록
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{purchase.doc_no}</span>
          <BookBadge book={book} />
          <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-xs">
            {STATUS_KO[purchase.status] ?? purchase.status}
          </span>
          {(() => {
            const pay = paymentBadge(purchase.status, purchase.paid_on, purchase.payment_due_on);
            if (!pay) return null;
            return (
              <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${pay.className}`}>
                {pay.label}
              </span>
            );
          })()}
          {!purchase.is_documented ? (
            <span className="inline-flex h-5 items-center rounded-full bg-amber-100 px-2 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              무자료
            </span>
          ) : null}
        </div>
      </div>

      {/* 메타 정보 */}
      <section className="grid grid-cols-2 gap-4 px-6 py-4 md:grid-cols-4">
        <MetaCard label="거래처">
          <div className="text-sm font-medium">{partner?.name ?? "—"}</div>
          {partner?.business_no ? (
            <div className="text-xs text-muted-foreground">{formatBusinessNo(partner.business_no)}</div>
          ) : null}
        </MetaCard>
        <MetaCard label="자료">
          <div className="text-sm">{TAX_DOC_KO[purchase.tax_doc_type] ?? purchase.tax_doc_type}</div>
          {purchase.tax_doc_no ? (
            <div className="text-xs text-muted-foreground font-mono">{purchase.tax_doc_no}</div>
          ) : null}
        </MetaCard>
        <MetaCard label="일정">
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-8 text-muted-foreground">발주</span>
              <span className="font-mono">{purchase.ordered_on}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-8 text-muted-foreground">입고</span>
              {purchase.delivered_on ? (
                <>
                  <span className="font-mono">{purchase.delivered_on}</span>
                  {(() => {
                    const d = arrivalDayBadge(purchase.delivered_on, purchase.status);
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
            {purchase.payment_due_on || purchase.paid_on ? (
              <div className="text-muted-foreground">
                {purchase.payment_due_on ? `결제예정 ${purchase.payment_due_on}` : ""}
                {purchase.paid_on ? ` · 완료 ${purchase.paid_on}` : ""}
              </div>
            ) : null}
          </div>
        </MetaCard>
        <MetaCard label="금액">
          <div className="text-sm tabular-nums">
            공급 {fmtKrw(Number(purchase.subtotal_krw))}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            VAT {fmtKrw(Number(purchase.vat_krw))} · 합계{" "}
            <span className="font-medium text-foreground">
              {fmtKrw(Number(purchase.total_krw))}
            </span>
          </div>
        </MetaCard>
      </section>

      {/* 매입 라인 표 */}
      <section className="px-6 pb-4">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">매입 라인</h2>
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">품목</th>
                <th className="px-3 py-2 text-left">규격</th>
                <th className="px-3 py-2 text-right">수량</th>
                <th className="px-3 py-2 text-right">단가</th>
                <th className="px-3 py-2 text-right">무게(kg)</th>
                <th className="px-3 py-2 text-right">소계</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    라인 없음
                  </td>
                </tr>
              ) : (
                lines.map((l) => {
                  const item = l.item;
                  const spec =
                    item?.category === "rebar" && item?.rebar_spec_code
                      ? [item.rebar_spec_code, item.rebar_grade_code, item.length_m ? `${item.length_m}M` : null]
                          .filter(Boolean)
                          .join(" ")
                      : "";
                  const weight = l.actual_weight_kg ?? l.theoretical_weight_kg;
                  const subtotal = Number(l.line_subtotal_krw ?? l.acquired_qty * l.unit_price_krw);
                  return (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2">{item?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{spec || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtNum(Number(l.acquired_qty), 2)} {l.acquired_unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtKrw(Number(l.unit_price_krw))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                        {weight ? fmtNum(Number(weight)) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {fmtKrw(subtotal)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 첨부 사진 — 클릭 시 라이트박스 (←/→ 키보드 네비) */}
      {attachments.length > 0 ? (
        <section className="px-6 pb-6">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            첨부 사진 ({attachments.length}장)
          </h2>
          <AttachmentGallery attachments={attachments} variant="square" />
        </section>
      ) : null}

      {/* 메모 */}
      {purchase.notes ? (
        <section className="px-6 pb-6">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">메모</h2>
          <p className="rounded-md border bg-card p-3 text-sm whitespace-pre-wrap">
            {purchase.notes}
          </p>
        </section>
      ) : null}
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
