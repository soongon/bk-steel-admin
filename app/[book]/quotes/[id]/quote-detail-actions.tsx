"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PrinterIcon, SendIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { type CompanyProfile } from "@/lib/company-profile";
import { type Book } from "@/lib/book";
import { markQuoteSent, deleteQuote } from "../actions";

/** 견적 상세의 액션 묶음 — 견적서 보기(출력)·발송 표시·삭제. */
export function QuoteDetailActions({
  quoteId,
  book,
  status,
  statementData,
  company,
}: {
  quoteId: string;
  book: Book;
  status: string;
  statementData: StatementData;
  company: CompanyProfile | null;
}) {
  const router = useRouter();
  const [showDoc, setShowDoc] = useState(false);
  const [pending, start] = useTransition();

  function onMarkSent() {
    start(async () => {
      const r = await markQuoteSent(quoteId, book);
      if (r.ok) {
        toast.success("발송 표시됨");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  function onDelete() {
    if (!confirm("이 견적서를 삭제할까요?")) return;
    start(async () => {
      const r = await deleteQuote(quoteId, book);
      if (r.ok) {
        toast.success("삭제됨");
        router.push(`/${book}/quotes`);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setShowDoc(true)}>
        <PrinterIcon className="size-4" /> 견적서 보기
      </Button>
      {status !== "sent" && status !== "won" ? (
        <Button variant="outline" size="sm" onClick={onMarkSent} disabled={pending}>
          <SendIcon className="size-4" /> 발송 표시
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={pending}
        className="text-muted-foreground hover:text-destructive"
        aria-label="삭제"
      >
        <Trash2Icon className="size-4" />
      </Button>

      {showDoc ? (
        <Dialog open onOpenChange={(o) => { if (!o) setShowDoc(false); }}>
          <DialogContent className="!max-w-[920px] max-h-[90vh] overflow-y-auto">
            <DialogHeader className="print:hidden">
              <DialogTitle>견적서</DialogTitle>
            </DialogHeader>
            <div className="bg-zinc-100 p-3 print:bg-white print:p-0 dark:bg-zinc-900">
              <div className="mx-auto max-w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
                <TradingStatement data={statementData} company={company} mode="quote" />
              </div>
            </div>
            <DialogFooter className="print:hidden">
              <Button variant="outline" onClick={() => setShowDoc(false)}>
                닫기
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <PrinterIcon className="size-4" /> 프린트
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
