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
import { PurchaseLifecyclePanel } from "./purchase-lifecycle-panel";
import { MemoLogPanel } from "@/components/admin/memo-log-panel";
import { MEMO_COLUMNS, type MemoEntry } from "@/lib/memo-log";
import { addPurchaseMemo, deletePurchaseMemo } from "./memo-actions";
import { type BankAccount } from "../pay-dialog";
import { type PurchaseRow } from "../purchase-form-dialog";
import { PurchaseEditButton } from "./purchase-edit-button";
import { PurchaseDeleteButton } from "./purchase-delete-button";
import { purchaseLineToDraft, type StoredPurchaseLine } from "@/lib/purchase-line-draft";

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
function paymentBadge(status: string, paidOn: string | null, dueOn: string | null, paid = 0, total = 0) {
  if (PAYMENT_REDUNDANT_STATUS.has(status)) return null;
  if (paidOn) {
    return {
      label: "결제완료",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    };
  }
  // 지운 매입에서 옮겨 온 출금이 이미 합계를 채움 — [결제완료]에서 추가 출금 없이 마무리된다.
  if (paid > 0 && paid >= total) {
    return {
      label: "출금 완료",
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
      tax_doc_type, tax_doc_no, tax_invoice_received_on, notes, origin, origin_ref,
      partner:partner(id, code, name, business_no, representative, address, phone, fax, industry, email),
      purchase_line(
        id, acquired_qty, acquired_unit, unit_price_krw, line_subtotal_krw,
        actual_weight_kg, theoretical_weight_kg, notes,
        item:item(id, name, code, rebar_spec_code, rebar_grade_code, length_m, category, bars_per_tonne)
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

  // 첨부 사진 + 메모 기록(0081, 시간순) + 지금 사용자(본인 메모만 삭제 버튼) — 동시에.
  // 사용자는 getClaims(JWT 확인) — getUser 는 Auth 서버 왕복이 끝날 때까지 같은 클라이언트의 다른 쿼리를 붙잡는다.
  const [{ data: attsData }, { data: memosData }, { data: claimsData }] = await Promise.all([
    supabase
      .from("attachment")
      .select(
        "id, entity_type, entity_id, kind, storage, path, url, thumbnail_url, mime, bytes, width, height, caption, sort_order, created_at",
      )
      .eq("entity_type", "purchase")
      .eq("entity_id", id)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("purchase_memo")
      .select(MEMO_COLUMNS)
      .eq("purchase_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase.auth.getClaims(),
  ]);
  const attachments = (attsData ?? []) as Attachment[];
  const memos = (memosData ?? []) as MemoEntry[];

  // 결제 통장(라이프사이클 결제 단계) + 수정 다이얼로그(PurchaseFormDialog 편집 모드)용 폼 데이터
  // + 연결된 홈택스 매입 계산서(0092, 있으면 합계 고정) — 동시에.
  const [{ data: bankAccounts }, editPartnersRes, editItemsRes, editRebarRes, editSitesRes, { data: hometaxRow }] =
    await Promise.all([
      supabase
        .from("bank_account")
        .select("id, code, bank_name, book, kind")
        .eq("book", book)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("is_primary", { ascending: false }),
      supabase.from("partner").select("id, code, name").is("deleted_at", null).eq("is_active", true).order("name"),
      supabase
        .from("item")
        .select("id, code, name, category, rebar_spec_code, rebar_grade_code, length_m, bars_per_tonne")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("name"),
      supabase.from("rebar_spec").select("spec_code, unit_weight_kg_per_m, standard_length_m").order("display_order"),
      supabase.from("site").select("id, name").is("deleted_at", null).eq("is_active", true).order("name"),
      supabase
        .from("hometax_invoice")
        .select("nts_confirm_num, supply_amount, total_amount")
        .eq("purchase_id", id)
        .gt("total_amount", 0) // 수정(−) 취소분 제외 — 당초·수정·재발행이 한 매입에 묶이면 유효한 (+) 최신 장
        .order("write_date", { ascending: false })
        .order("issue_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  // 출금 내역(통장 출금, 음수) — 지운 매입에서 옮겨 온 결제가 있거나 출금 합이 합계와 다를 때만 보여 준다.
  const { data: paymentData } = await supabase
    .from("bank_transaction")
    .select("id, txn_on, amount_krw, notes, bank_account:bank_account!bank_transaction_bank_account_id_fkey(code, bank_name)")
    .eq("purchase_id", id)
    .is("deleted_at", null)
    .lt("amount_krw", 0)
    .order("txn_on", { ascending: true })
    .order("created_at", { ascending: true });
  const payments = (paymentData ?? []) as unknown as Array<{
    id: string;
    txn_on: string;
    amount_krw: number;
    notes: string | null;
    bank_account: { code: string; bank_name: string } | null;
  }>;
  const paidKrw = payments.reduce((a, d) => a - Number(d.amount_krw), 0);
  const showPayments =
    payments.length > 1 ||
    (payments.length > 0 && (paidKrw !== Number(purchase.total_krw) || !purchase.paid_on));

  const purchaseRow: PurchaseRow = {
    id: purchase.id,
    book,
    doc_no: purchase.doc_no,
    partner_id: purchase.partner_id,
    site_id: (purchase as { site_id?: string | null }).site_id ?? null,
    site_name: (purchase as { site_name?: string | null }).site_name ?? null,
    ordered_on: purchase.ordered_on,
    delivered_on: purchase.delivered_on,
    paid_on: purchase.paid_on,
    payment_due_on: purchase.payment_due_on,
    status: purchase.status,
    is_documented: purchase.is_documented,
    tax_doc_type: purchase.tax_doc_type,
    tax_doc_no: purchase.tax_doc_no,
    notes: purchase.notes,
    // 라인 편집(0093) — 기존 라인 프리필 + 합계 고정 여부(홈택스 수집본 연결).
    lines: lines.map((l) => purchaseLineToDraft(l as StoredPurchaseLine)),
    subtotal_krw: Number(purchase.subtotal_krw),
    total_krw: Number(purchase.total_krw),
    origin: (purchase as { origin?: string | null }).origin ?? null,
    invoice: hometaxRow
      ? {
          supply_krw: Number(hometaxRow.supply_amount ?? purchase.subtotal_krw),
          total_krw: Number(hometaxRow.total_amount ?? purchase.total_krw),
          nts_confirm_num: hometaxRow.nts_confirm_num ?? null,
        }
      : null,
  };

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
            const pay = paymentBadge(purchase.status, purchase.paid_on, purchase.payment_due_on, paidKrw, Number(purchase.total_krw));
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
          {purchaseRow.origin === "hometax" ? (
            <span className="inline-flex h-5 items-center rounded-full bg-orange-100 px-2 text-xs text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
              홈택스
            </span>
          ) : null}
          <PurchaseEditButton
            purchase={purchaseRow}
            view={book}
            partners={editPartnersRes.data ?? []}
            items={editItemsRes.data ?? []}
            rebarSpecs={editRebarRes.data ?? []}
            sites={editSitesRes.data ?? []}
          />
          <PurchaseDeleteButton purchaseId={purchase.id} docNo={purchase.doc_no} listHref={`/${bookParam}/purchases`} />
        </div>
      </div>

      {/* 거래 라이프사이클 (발주→입고→계산서 수취→결제) */}
      <div className="px-6 pt-4">
        <PurchaseLifecyclePanel
          purchase={{
            id: purchase.id,
            doc_no: purchase.doc_no,
            book,
            status: purchase.status,
            delivered_on: purchase.delivered_on,
            paid_on: purchase.paid_on,
            tax_invoice_received_on: (purchase as { tax_invoice_received_on: string | null }).tax_invoice_received_on ?? null,
            is_documented: purchase.is_documented,
            tax_doc_type: purchase.tax_doc_type,
            total_krw: Number(purchase.total_krw),
          }}
          bankAccounts={(bankAccounts ?? []) as BankAccount[]}
        />
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

      {/* 출금 내역 — 합치기·다시 만들기로 옮겨 온 결제가 있을 때 */}
      {showPayments ? (
        <section className="px-6 pb-4">
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-sm">
              <span className="font-medium">출금 내역 ({payments.length}건)</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                출금 {fmtKrw(paidKrw)} / 합계 {fmtKrw(Number(purchase.total_krw))}
                {paidKrw < Number(purchase.total_krw) ? (
                  <span className="text-amber-700 dark:text-amber-400"> · 남은 미지급 {fmtKrw(Number(purchase.total_krw) - paidKrw)}</span>
                ) : paidKrw > Number(purchase.total_krw) ? (
                  <span className="text-destructive"> · 초과 출금 {fmtKrw(paidKrw - Number(purchase.total_krw))}</span>
                ) : null}
              </span>
            </div>
            <ul className="divide-y text-sm">
              {payments.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="font-mono text-xs">{d.txn_on}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={d.notes ?? undefined}>
                    {d.bank_account ? `${d.bank_account.code} · ${d.bank_account.bank_name}` : "—"}
                    {d.notes ? ` · ${d.notes}` : ""}
                  </span>
                  <span className="tabular-nums">{fmtKrw(-Number(d.amount_krw))}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

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
                      <td className="px-3 py-2">
                        {item?.name ?? "—"}
                        {l.notes ? <div className="text-[11px] text-muted-foreground">{l.notes}</div> : null}
                      </td>
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

      {/* 메모 — 등록 메모(purchase.notes) + 시간순 기록(purchase_memo), 바로 추가 */}
      <section className="px-6 pb-6">
        <MemoLogPanel
          parentId={purchase.id}
          registeredNote={purchase.notes}
          registeredLabel="매입 등록·수정에서 쓴 메모"
          memos={memos}
          currentUserId={claimsData?.claims.sub ?? null}
          addMemoAction={addPurchaseMemo}
          deleteMemoAction={deletePurchaseMemo}
        />
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
