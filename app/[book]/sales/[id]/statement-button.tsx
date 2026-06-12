"use client";

import { useState } from "react";
import { FileSpreadsheetIcon, FileTextIcon, PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { type CompanyProfile } from "@/lib/company-profile";

/** 거래명세표 — 버튼으로 모달 열기(신규 폼과 동일 패턴). 공급받는자 보관용 1매. */
export function StatementButton({
  data,
  company,
}: {
  data: StatementData;
  company: CompanyProfile | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileSpreadsheetIcon className="size-4" />
        거래명세표
      </Button>

      {open ? (
        <Dialog open onOpenChange={(o) => { if (!o) setOpen(false); }}>
          <DialogContent className="!max-w-[920px] max-h-[90vh] overflow-y-auto">
            <DialogHeader className="print:hidden">
              <DialogTitle>거래명세표 — {data.doc_no}</DialogTitle>
            </DialogHeader>
            <div className="bg-zinc-100 p-3 print:bg-white print:p-0 dark:bg-zinc-900">
              <div className="mx-auto max-w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
                <TradingStatement data={data} company={company} recipientOnly />
              </div>
            </div>
            <DialogFooter className="print:hidden">
              <Button variant="outline" onClick={() => setOpen(false)}>
                닫기
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <PrinterIcon className="size-4" /> 프린트
              </Button>
              <Button variant="secondary" disabled title="세금계산서 발급은 준비 중입니다">
                <FileTextIcon className="size-4" /> 계산서 발급
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
