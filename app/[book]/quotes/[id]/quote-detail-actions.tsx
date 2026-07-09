"use client";

import { useRef, useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { QuoteDocument, type QuoteDocumentData } from "@/components/admin/quote-document";
import { type CompanyProfile } from "@/lib/company-profile";
import { type Book } from "@/lib/book";
import { digitsOnly } from "@/lib/format";
import { markQuoteSent, deleteQuote } from "../actions";
import { sendQuoteMms } from "../sms-actions";
import { captureNodeToJpeg } from "@/lib/capture-node";

/**
 * 견적 상세의 액션 묶음 — 견적서 보기(출력)·문자(MMS) 전송·발송 표시·삭제.
 * 견적서 보기 모달의 QuoteDocument DOM 을 html2canvas-pro 로 캡처해 거래처에 MMS 전송(StatementButton 패턴).
 */
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
  statementData: QuoteDocumentData;
  company: CompanyProfile | null;
}) {
  const router = useRouter();
  const [showDoc, setShowDoc] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const captureRef = useRef<HTMLDivElement>(null);

  const defaultPhone = statementData.partner.phone ?? "";
  const siteName = statementData.site_name ?? undefined;

  function openSms() {
    setPhone(defaultPhone);
    setSmsOpen(true);
  }

  function handleSendSms() {
    if (!captureRef.current) return;
    if (digitsOnly(phone).length < 10) {
      toast.error("수신 번호를 확인하세요.");
      return;
    }
    const node = captureRef.current;
    start(async () => {
      let dataUrl: string;
      try {
        dataUrl = await captureNodeToJpeg(node); // 200KB 이하 자동 압축
      } catch {
        toast.error("견적서 이미지 생성 실패");
        return;
      }
      const r = await sendQuoteMms(quoteId, dataUrl, phone, siteName, company?.name ?? undefined);
      if (r.ok) {
        toast.success("견적서 문자(MMS) 전송됨");
        setSmsOpen(false);
        setShowDoc(false);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

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
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setShowDoc(false);
              setSmsOpen(false);
            }
          }}
        >
          <DialogContent className="!max-w-[920px] max-h-[90vh] overflow-y-auto">
            <DialogHeader className="print:hidden">
              <DialogTitle>견적서 — {statementData.doc_no}</DialogTitle>
            </DialogHeader>

            {/* 캡처 대상: 800px 고정. 좁은 화면은 가로 스크롤, 프린트는 폭 해제. */}
            <div className="overflow-x-auto bg-zinc-100 p-3 print:overflow-visible print:bg-white print:p-0 dark:bg-zinc-900">
              <div
                ref={captureRef}
                className="mx-auto w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none"
              >
                <QuoteDocument data={statementData} company={company} />
              </div>
            </div>

            {/* 문자 전송 — 인라인 수신번호(펼침). */}
            {smsOpen ? (
              <div className="flex items-end gap-2 rounded-lg border bg-muted/30 p-3 print:hidden">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">수신 번호 *</span>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    inputMode="numeric"
                  />
                  {!defaultPhone ? (
                    <span className="text-xs text-amber-600">거래처 휴대폰이 없습니다 — 직접 입력</span>
                  ) : null}
                </label>
                <Button onClick={handleSendSms} disabled={pending}>
                  {pending ? "전송 중..." : "전송"}
                </Button>
                <Button variant="ghost" onClick={() => setSmsOpen(false)} disabled={pending}>
                  취소
                </Button>
              </div>
            ) : null}

            <DialogFooter className="print:hidden">
              <Button variant="outline" onClick={() => setShowDoc(false)}>
                닫기
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <PrinterIcon className="size-4" /> 프린트
              </Button>
              {!smsOpen ? (
                <Button variant="secondary" onClick={openSms}>
                  <SendIcon className="size-4" /> 문자 전송
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
