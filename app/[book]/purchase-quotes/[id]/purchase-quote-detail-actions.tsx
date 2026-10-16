"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, PrinterIcon, SendIcon, Trash2Icon } from "lucide-react";
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
import { PurchaseQuoteDocument, type PurchaseQuoteDocumentData } from "@/components/admin/purchase-quote-document";
import { type CompanyProfile } from "@/lib/company-profile";
import { type Book } from "@/lib/book";
import { type PurchaseQuoteStatus } from "@/lib/purchase-quote";
import { digitsOnly } from "@/lib/format";
import { captureNodeForMail, captureNodeToJpeg } from "@/lib/capture-node";
import { type MailStatus } from "@/lib/mail/address";
import { MailButton, MailSendPanel } from "@/components/admin/mail-send-panel";
import { markPurchaseQuoteSent, markPurchaseQuoteDone, deletePurchaseQuote } from "../actions";
import { sendPurchaseQuoteMms } from "../sms-actions";
import { sendPurchaseQuoteMail } from "../mail-actions";

/** 매입견적 상세 액션 — 보기(인쇄)·문자(MMS)·메일(PDF)·발송 표시·매입 완료·삭제. (QuoteDetailActions 미러) */
export function PurchaseQuoteDetailActions({
  quoteId,
  book,
  status,
  docData,
  company,
  mailStatus,
  defaultMailTo,
}: {
  quoteId: string;
  book: Book;
  status: PurchaseQuoteStatus;
  docData: PurchaseQuoteDocumentData;
  company: CompanyProfile | null;
  mailStatus: MailStatus;
  defaultMailTo: string; // 판매자 거래처 이메일 1·2(문서 데이터에는 없음)
}) {
  const router = useRouter();
  const [showDoc, setShowDoc] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const captureRef = useRef<HTMLDivElement>(null);

  const defaultPhone = docData.partner.phone ?? "";
  const siteName = docData.site_name ?? undefined;

  function openSms() {
    setPhone(defaultPhone);
    setMailOpen(false);
    setSmsOpen(true);
  }
  /** 헤더의 '문자 전송' — 문서 모달을 열면서 수신번호 입력까지 바로 펼친다. */
  function openDocWithSms() {
    setShowDoc(true);
    openSms();
  }
  function openMail() {
    setSmsOpen(false);
    setMailOpen(true);
  }
  /** 모달 닫기 — [닫기]·바깥 클릭·ESC 모두 이 길로(펼친 문자·메일 칸이 다음에 열 때 남지 않게). */
  function closeDoc() {
    setShowDoc(false);
    setSmsOpen(false);
    setMailOpen(false);
  }
  /** 헤더의 '메일 전송' — 문서 모달을 열면서 받는 주소 입력까지 바로 펼친다. */
  function openDocWithMail() {
    setShowDoc(true);
    openMail();
  }

  function handleSendMail(to: string, note: string) {
    if (!captureRef.current) return;
    const node = captureRef.current;
    start(async () => {
      let dataUrl: string;
      try {
        dataUrl = await captureNodeForMail(node); // PDF 용 고화질
      } catch {
        toast.error("매입견적서 이미지 생성 실패");
        return;
      }
      let r: Awaited<ReturnType<typeof sendPurchaseQuoteMail>>;
      try {
        r = await sendPurchaseQuoteMail(quoteId, dataUrl, to, note);
      } catch {
        toast.error("메일 전송 실패 — 잠시 후 다시 시도하세요.");
        return;
      }
      if (r.ok) {
        if (r.warning) toast.warning(r.warning);
        else toast.success("매입견적서 메일 전송됨");
        setMailOpen(false);
        setShowDoc(false);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
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
        dataUrl = await captureNodeToJpeg(node);
      } catch {
        toast.error("매입견적서 이미지 생성 실패");
        return;
      }
      const r = await sendPurchaseQuoteMms(quoteId, dataUrl, phone, siteName, company?.name ?? undefined);
      if (r.ok) {
        toast.success("매입견적서 문자(MMS) 전송됨");
        setSmsOpen(false);
        setShowDoc(false);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(okMsg);
        if (after) after();
        else router.refresh();
      } else {
        toast.error(r.error ?? "실패");
      }
    });

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setShowDoc(true)}>
        <PrinterIcon className="size-4" /> 견적서 보기
      </Button>
      <Button size="sm" onClick={openDocWithSms}>
        <SendIcon className="size-4" /> 문자 전송
      </Button>
      <MailButton status={mailStatus} size="sm" variant="outline" onClick={openDocWithMail} />
      {status === "draft" ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => markPurchaseQuoteSent(quoteId, book), "발송 표시됨")}>
          <SendIcon className="size-4" /> 발송 표시
        </Button>
      ) : null}
      {status === "draft" || status === "sent" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (!confirm("계근·매입 등록을 마쳤나요? 이 견적을 '매입 완료'로 표시합니다.")) return;
            run(() => markPurchaseQuoteDone(quoteId, book), "매입 완료로 표시됨");
          }}
        >
          <CheckCircle2Icon className="size-4" /> 매입 완료
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        className="text-muted-foreground hover:text-destructive"
        aria-label="삭제"
        onClick={() => {
          if (!confirm("이 매입견적서를 삭제할까요?")) return;
          run(() => deletePurchaseQuote(quoteId, book), "삭제됨", () => router.push(`/${book}/purchase-quotes`));
        }}
      >
        <Trash2Icon className="size-4" />
      </Button>

      {showDoc ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) closeDoc();
          }}
        >
          <DialogContent className="!max-w-[920px] max-h-[90vh] overflow-y-auto">
            <DialogHeader className="print:hidden">
              <DialogTitle>매입견적서 — {docData.doc_no}</DialogTitle>
            </DialogHeader>

            {/* 캡처 대상: 800px 고정. 좁은 화면은 가로 스크롤, 프린트는 폭 해제. */}
            <div className="overflow-x-auto bg-zinc-100 p-3 print:overflow-visible print:bg-white print:p-0 dark:bg-zinc-900">
              <div
                ref={captureRef}
                className="mx-auto w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none"
              >
                <PurchaseQuoteDocument data={docData} company={company} />
              </div>
            </div>

            {smsOpen ? (
              <div className="flex items-end gap-2 rounded-lg border bg-muted/30 p-3 print:hidden">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">수신 번호 *</span>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" inputMode="numeric" />
                  {!defaultPhone ? <span className="text-xs text-amber-600">판매자 전화가 없습니다 — 직접 입력</span> : null}
                </label>
                <Button onClick={handleSendSms} disabled={pending}>
                  {pending ? "전송 중..." : "전송"}
                </Button>
                <Button variant="ghost" onClick={() => setSmsOpen(false)} disabled={pending}>
                  취소
                </Button>
              </div>
            ) : null}

            {mailOpen ? (
              <MailSendPanel
                defaultTo={defaultMailTo}
                pending={pending}
                onSend={handleSendMail}
                onCancel={() => setMailOpen(false)}
              />
            ) : null}

            <DialogFooter className="print:hidden">
              <Button variant="outline" onClick={closeDoc}>
                닫기
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <PrinterIcon className="size-4" /> 프린트
              </Button>
              {!smsOpen && !mailOpen ? (
                <Button variant="secondary" onClick={openSms}>
                  <SendIcon className="size-4" /> 문자 전송
                </Button>
              ) : null}
              {!smsOpen && !mailOpen ? <MailButton status={mailStatus} onClick={openMail} /> : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
