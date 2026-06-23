"use client";

import { useState, useTransition } from "react";
import {
  CheckIcon,
  CircleDollarSignIcon,
  ClipboardListIcon,
  FileSignatureIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  ReceiptTextIcon,
  TruckIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type Book } from "@/lib/book";
import { deliveryDday } from "@/lib/sale-lifecycle";
import { type CompanyProfile } from "@/lib/company-profile";
import { type StatementData } from "@/components/admin/trading-statement";
import { type DeliveryCertificate } from "@/lib/delivery-certificate";
import { type DeliveryCertData } from "@/components/admin/delivery-cert-form";
import { StatementButton } from "./statement-button";
import { DeliveryCertButton } from "./delivery-cert-button";
import { TaxInvoiceButton, type SaleTaxInvoice } from "./tax-invoice-button";
import { SettleDialog, type BankAccount } from "../settle-dialog";
import { taxDocMode } from "@/lib/tax-invoice";
import { markSaleDelivered, toggleSaleStatementSent } from "../actions";

export type LifecycleSale = {
  id: string;
  doc_no: string;
  book: Book;
  status: string;
  ordered_on: string;
  delivered_on: string | null;
  settled_on: string | null;
  payment_due_on: string | null;
  delivery_cert_id: string | null;
  statement_sent_on: string | null;
  tax_invoice_issued_on: string | null;
  is_documented: boolean;
  tax_doc_type: string;
  total_krw: number;
  partner_id: string;
  site_id: string | null;
};

/**
 * 매출 거래 라이프사이클 — 주문→납품→명세표 송부→계산서 발행→수금→납품확인서 6단계 한눈에.
 * 명세표·계산서는 단순 토글(날짜 set/null), 납품·수금·확인서는 기존 액션. 순서는 소프트 가드.
 */
export function SaleLifecyclePanel({
  sale,
  bankAccounts,
  company,
  statementData,
  cert,
  certFormData,
  taxInvoice,
}: {
  sale: LifecycleSale;
  bankAccounts: BankAccount[];
  company: CompanyProfile | null;
  statementData: StatementData;
  cert: DeliveryCertificate | null;
  certFormData: DeliveryCertData | null;
  taxInvoice: SaleTaxInvoice | null;
}) {
  const [pending, startTransition] = useTransition();
  const [delivering, startDeliver] = useTransition();
  const [settleOpen, setSettleOpen] = useState(false);

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }); // KST 'YYYY-MM-DD'
  // 납품 done: 상태머신만(delivered/settled/overdue). 납품일이 도래·지남해도 자동완료 아님 —
  // '납품완료' 버튼으로만 완료. 납품일은 D-day(D-0/D+n) 표시로만 쓴다.
  const delivered = ["delivered", "settled", "overdue"].includes(sale.status);
  const settled = sale.status === "settled" || !!sale.settled_on;
  const invoiceMode = taxDocMode(sale.book, sale.is_documented, sale.tax_doc_type);
  const invoiceNA = invoiceMode === "none"; // 세금계산서 비대상(무자료·B·현금영수증·간이)

  const steps = [
    { key: "order", label: "주문", Icon: ClipboardListIcon, done: true, date: sale.ordered_on, na: false },
    { key: "deliver", label: "납품", Icon: TruckIcon, done: delivered, date: sale.delivered_on, na: false },
    { key: "statement", label: "명세표 송부", Icon: FileSpreadsheetIcon, done: !!sale.statement_sent_on, date: sale.statement_sent_on, na: false },
    { key: "invoice", label: "계산서 발행", Icon: ReceiptTextIcon, done: !!sale.tax_invoice_issued_on, date: sale.tax_invoice_issued_on, na: invoiceNA },
    { key: "settle", label: "수금", Icon: CircleDollarSignIcon, done: settled, date: sale.settled_on, na: false },
    { key: "cert", label: "납품확인서", Icon: FileSignatureIcon, done: !!sale.delivery_cert_id, date: null as string | null, na: false },
  ];
  const doneCount = steps.filter((s) => s.done || s.na).length;

  // 소프트 가드: 명세표 미송부인데 계산서 발행 시 경고
  const invoiceBeforeStatement = !!sale.tax_invoice_issued_on && !sale.statement_sent_on && !invoiceNA;

  function deliver() {
    startDeliver(async () => {
      const r = await markSaleDelivered(sale.id);
      if (r.ok) toast.success("납품완료 처리됨");
      else toast.error(r.error);
    });
  }
  function toggleStatement() {
    startTransition(async () => {
      const r = await toggleSaleStatementSent(sale.id, !sale.statement_sent_on);
      if (!r.ok) toast.error(r.error);
    });
  }
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">거래 진행</h2>
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{doneCount}</span> / 6 단계
        </span>
      </div>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((s) => {
          const isDone = s.done && !s.na;
          const cardClass = isDone
            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20"
            : s.na
              ? "border-dashed bg-muted/30"
              : "border-border bg-background";
          return (
            <li key={s.key} className={`flex flex-col gap-1.5 rounded-lg border p-2.5 ${cardClass}`}>
              <div className="flex items-center gap-1.5">
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                    isDone ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isDone ? <CheckIcon className="size-3.5" /> : <s.Icon className="size-3.5" />}
                </span>
                <span className="text-xs font-medium">{s.label}</span>
              </div>

              <div className="min-h-[1.5rem] text-[11px]">
                {s.na ? (
                  <span className="text-muted-foreground">해당없음 (무자료)</span>
                ) : isDone ? (
                  <span className="font-mono text-emerald-700 dark:text-emerald-300">{s.date ?? "완료"}</span>
                ) : s.key === "deliver" && sale.delivered_on ? (
                  (() => {
                    const { dday, label } = deliveryDday(sale.delivered_on, today);
                    const tone =
                      dday > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : dday === 0
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-red-600 dark:text-red-400";
                    return (
                      <span className={`font-mono ${tone}`}>
                        {dday > 0 ? `예정 ${sale.delivered_on}` : `${label} · ${sale.delivered_on}`}
                      </span>
                    );
                  })()
                ) : (
                  <span className="text-muted-foreground">대기</span>
                )}
              </div>

              {/* 단계별 액션 */}
              <div className="mt-auto flex flex-wrap gap-1">
                {s.key === "deliver" && !s.done ? (
                  <Button size="xs" variant="outline" onClick={deliver} disabled={delivering}>
                    {delivering ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                    납품완료
                  </Button>
                ) : null}

                {s.key === "statement" ? (
                  <>
                    <StatementButton data={statementData} company={company} sms={{ saleId: sale.id }} />
                    <Button size="xs" variant={s.done ? "secondary" : "outline"} onClick={toggleStatement} disabled={pending}>
                      {s.done ? "송부 해제" : "송부 완료"}
                    </Button>
                  </>
                ) : null}

                {s.key === "invoice" && !s.na ? (
                  <TaxInvoiceButton
                    saleId={sale.id}
                    mode={invoiceMode}
                    taxInvoice={taxInvoice}
                    statementData={statementData}
                    company={company}
                  />
                ) : null}

                {s.key === "settle" && !s.done ? (
                  delivered ? (
                    <Button size="xs" variant="outline" onClick={() => setSettleOpen(true)}>
                      수금완료
                    </Button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">납품 후 가능</span>
                  )
                ) : null}

                {s.key === "cert" ? (
                  certFormData ? (
                    <DeliveryCertButton
                      book={sale.book}
                      partnerId={sale.partner_id}
                      siteId={sale.site_id}
                      cert={cert}
                      formData={certFormData}
                      company={company}
                    />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">현장 지정 필요</span>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {invoiceBeforeStatement ? (
        <p className="mt-2 text-[11px] text-amber-600">
          ⚠ 거래명세표 송부 표시 없이 계산서가 발행되었습니다 (권장 순서: 명세표 → 계산서).
        </p>
      ) : null}

      {settleOpen ? (
        <SettleDialog sale={sale} bankAccounts={bankAccounts} onClose={() => setSettleOpen(false)} />
      ) : null}
    </section>
  );
}
