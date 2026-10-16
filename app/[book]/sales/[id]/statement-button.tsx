"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheetIcon, PrinterIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormattedInput } from "@/components/admin/formatted-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { type CompanyProfile } from "@/lib/company-profile";
import { digitsOnly, formatPhone } from "@/lib/format";
import { sendStatementSms } from "./sms-actions";
import { sendStatementMail } from "./mail-actions";
import { captureNodeForMail, captureNodeToJpeg } from "@/lib/capture-node";
import { defaultMailTo, type MailStatus } from "@/lib/mail/address";
import { MailButton, MailSendPanel } from "@/components/admin/mail-send-panel";

/**
 * 거래명세표 — 버튼으로 모달 열기(공급받는자 보관용 1매).
 * sms 를 넘기면 모달 하단에 문자(MMS) 전송 기능이 노출된다 — 모달의 명세표 DOM 을
 * html2canvas-pro 로 캡처해 거래처 휴대폰으로 전송. (별도 SmsButton 을 흡수한 통합본)
 * mail 을 넘기면 같은 명세표를 PDF 로 첨부해 메일 전송(받는 주소 기본값 = 거래처 이메일 1·2).
 */
export function StatementButton({
  data,
  company,
  sms,
  mail,
}: {
  data: StatementData;
  company: CompanyProfile | null;
  sms?: { saleId: string; defaultPhone?: string | null; siteName?: string | null };
  mail?: { saleId: string; status: MailStatus };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const captureRef = useRef<HTMLDivElement>(null);

  // 수신번호·현장명 기본값: 명시 prop > statementData fallback
  const defaultPhone = sms?.defaultPhone ?? data.partner.phone ?? "";
  const siteName = sms?.siteName ?? data.site_name ?? undefined;

  function openSms() {
    setPhone(formatPhone(defaultPhone)); // 저장값(숫자만)을 대시 표기로
    setMailOpen(false);
    setSmsOpen(true);
  }

  /** 모달 닫기 — [닫기]·바깥 클릭·ESC 모두 이 길로(펼친 문자·메일 칸이 다음에 열 때 남지 않게). */
  function closeDoc() {
    setOpen(false);
    setSmsOpen(false);
    setMailOpen(false);
  }

  function handleSendMail(to: string, note: string) {
    if (!mail || !captureRef.current) return;
    const node = captureRef.current;
    startTransition(async () => {
      let dataUrl: string;
      try {
        dataUrl = await captureNodeForMail(node); // PDF 용 고화질(문자 이미지보다 큼)
      } catch {
        toast.error("명세서 이미지 생성 실패");
        return;
      }
      let r: Awaited<ReturnType<typeof sendStatementMail>>;
      try {
        r = await sendStatementMail(mail.saleId, dataUrl, to, note);
      } catch {
        toast.error("메일 전송 실패 — 잠시 후 다시 시도하세요.");
        return;
      }
      if (r.ok) {
        if (r.warning) toast.warning(r.warning);
        else toast.success("명세서 메일 전송됨");
        setMailOpen(false);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  function handleSendSms() {
    if (!sms || !captureRef.current) return;
    if (digitsOnly(phone).length < 10) {
      toast.error("수신 번호를 확인하세요.");
      return;
    }
    const node = captureRef.current;
    startTransition(async () => {
      let dataUrl: string;
      try {
        dataUrl = await captureNodeToJpeg(node); // 200KB 이하 자동 압축
      } catch {
        toast.error("명세서 이미지 생성 실패");
        return;
      }
      const r = await sendStatementSms(sms.saleId, dataUrl, phone, siteName, company?.name ?? undefined);
      if (r.ok) {
        toast.success("명세서 문자(MMS) 전송됨");
        setSmsOpen(false);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileSpreadsheetIcon className="size-4" />
        거래명세표
      </Button>

      {open ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) closeDoc();
          }}
        >
          <DialogContent className="!max-w-[920px] max-h-[90vh] overflow-y-auto">
            <DialogHeader className="print:hidden">
              <DialogTitle>거래명세표 — {data.doc_no}</DialogTitle>
            </DialogHeader>

            {/* 캡처 대상: 800px 고정(실제 명세표 비율). 좁은 화면은 가로 스크롤, 프린트는 폭 해제. */}
            <div className="overflow-x-auto bg-zinc-100 p-3 print:overflow-visible print:bg-white print:p-0 dark:bg-zinc-900">
              <div
                ref={captureRef}
                className="mx-auto w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none"
              >
                <TradingStatement data={data} company={company} recipientOnly />
              </div>
            </div>

            {/* 문자 전송 — 인라인 수신번호(펼침). 항상 노출하면 검토/프린트 모달이 무거워짐. */}
            {sms && smsOpen ? (
              <div className="flex items-end gap-2 rounded-lg border bg-muted/30 p-3 print:hidden">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">수신 번호 *</span>
                  <FormattedInput
                    format="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-0000-0000"
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

            {mail && mailOpen ? (
              <MailSendPanel
                defaultTo={defaultMailTo(data.partner.email, data.partner.email2)}
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
              {sms && !smsOpen && !mailOpen ? (
                <Button variant="secondary" onClick={openSms}>
                  <SendIcon className="size-4" /> 문자 전송
                </Button>
              ) : null}
              {mail && !smsOpen && !mailOpen ? (
                <MailButton
                  status={mail.status}
                  onClick={() => {
                    setSmsOpen(false);
                    setMailOpen(true);
                  }}
                />
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
