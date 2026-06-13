"use client";

import { useState, useTransition } from "react";
import {
  BanknoteIcon,
  CheckIcon,
  ClipboardListIcon,
  PackageCheckIcon,
  ReceiptTextIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type Book } from "@/lib/book";
import { PayDialog, type BankAccount } from "../pay-dialog";
import { markPurchaseReceived, togglePurchaseTaxInvoiceReceived } from "../actions";

export type LifecyclePurchase = {
  id: string;
  doc_no: string;
  book: Book;
  status: string;
  delivered_on: string | null;
  paid_on: string | null;
  tax_invoice_received_on: string | null;
  is_documented: boolean;
  tax_doc_type: string;
  total_krw: number;
};

/**
 * 매입 거래 라이프사이클 — 발주→입고→계산서 수취→결제 4단계 한눈에.
 * 계산서 수취는 단순 토글, 입고=markPurchaseReceived, 결제=PayDialog(통장 출금). 무자료=계산서 '해당없음'.
 */
export function PurchaseLifecyclePanel({
  purchase,
  bankAccounts,
}: {
  purchase: LifecyclePurchase;
  bankAccounts: BankAccount[];
}) {
  const [pending, startTransition] = useTransition();
  const [payOpen, setPayOpen] = useState(false);

  const received = purchase.status !== "ordered" || !!purchase.delivered_on;
  const invoiceNA = !purchase.is_documented || purchase.tax_doc_type === "none";

  const steps = [
    { key: "order", label: "발주", Icon: ClipboardListIcon, done: true, date: null as string | null, na: false },
    { key: "receive", label: "입고", Icon: PackageCheckIcon, done: received, date: purchase.delivered_on, na: false },
    { key: "invoice", label: "계산서 수취", Icon: ReceiptTextIcon, done: !!purchase.tax_invoice_received_on, date: purchase.tax_invoice_received_on, na: invoiceNA },
    { key: "pay", label: "결제", Icon: BanknoteIcon, done: !!purchase.paid_on, date: purchase.paid_on, na: false },
  ];
  const doneCount = steps.filter((s) => s.done || s.na).length;

  function receive() {
    if (purchase.status !== "ordered") return;
    if (!window.confirm(`[${purchase.doc_no}] 입고완료로 처리하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await markPurchaseReceived(purchase.id);
      if (r.ok) toast.success("입고완료 처리됨");
      else toast.error(r.error);
    });
  }
  function toggleInvoice() {
    startTransition(async () => {
      const r = await togglePurchaseTaxInvoiceReceived(purchase.id, !purchase.tax_invoice_received_on);
      if (!r.ok) toast.error(r.error);
    });
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">거래 진행</h2>
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{doneCount}</span> / 4 단계
        </span>
      </div>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                ) : (
                  <span className="text-muted-foreground">대기</span>
                )}
              </div>

              <div className="mt-auto flex flex-wrap gap-1">
                {s.key === "receive" && !s.done ? (
                  <Button size="xs" variant="outline" onClick={receive} disabled={pending}>
                    입고완료
                  </Button>
                ) : null}
                {s.key === "invoice" && !s.na ? (
                  <Button size="xs" variant={s.done ? "secondary" : "outline"} onClick={toggleInvoice} disabled={pending}>
                    {s.done ? "수취 해제" : "수취 완료"}
                  </Button>
                ) : null}
                {s.key === "pay" && !s.done ? (
                  received ? (
                    <Button size="xs" variant="outline" onClick={() => setPayOpen(true)}>
                      결제완료
                    </Button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">입고 후 가능</span>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {payOpen ? (
        <PayDialog purchase={purchase} bankAccounts={bankAccounts} onClose={() => setPayOpen(false)} />
      ) : null}
    </section>
  );
}
