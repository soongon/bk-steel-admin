"use client";

import { useRef, useState, useTransition } from "react";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormattedInput } from "@/components/admin/formatted-input";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { type CompanyProfile } from "@/lib/company-profile";
import { type Book } from "@/lib/book";
import { digitsOnly, formatPhone } from "@/lib/format";
import { captureNodeForMail, captureNodeToJpeg } from "@/lib/capture-node";
import { type MailStatus } from "@/lib/mail/address";
import { MailButton, MailSendPanel } from "@/components/admin/mail-send-panel";
import { sendSiteStatementSms } from "./sms-actions";
import { sendSiteStatementMail } from "./mail-actions";

/**
 * 현장 누적 명세서 본체 + 문자(MMS)·메일(PDF) 전송 — StatementButton 의 인라인 전송 UI 미러.
 * 명세서 DOM 을 html2canvas-pro 로 캡처해 거래처 휴대폰(문자) 또는 메일(PDF 첨부)로 전송.
 */
export function SiteStatementView({
  data,
  company,
  siteId,
  book,
  defaultPhone,
  mail,
}: {
  data: StatementData;
  company: CompanyProfile | null;
  siteId: string;
  book: Book;
  defaultPhone: string | null;
  mail?: { status: MailStatus; defaultTo: string; viewBook: string; groupBook: string | null; partnerId: string | null };
}) {
  const [smsOpen, setSmsOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const captureRef = useRef<HTMLDivElement>(null);

  function openSms() {
    setPhone(formatPhone(defaultPhone)); // 저장값(숫자만)을 대시 표기로
    setMailOpen(false);
    setSmsOpen(true);
  }

  function handleSendMail(to: string, note: string) {
    if (!mail || !captureRef.current) return;
    const node = captureRef.current;
    startTransition(async () => {
      let dataUrl: string;
      try {
        dataUrl = await captureNodeForMail(node); // PDF 용 고화질
      } catch {
        toast.error("명세서 이미지 생성 실패");
        return;
      }
      let r: Awaited<ReturnType<typeof sendSiteStatementMail>>;
      try {
        r = await sendSiteStatementMail({
          siteId,
          viewBook: mail.viewBook,
          groupBook: mail.groupBook,
          partnerId: mail.partnerId,
          imageDataUrl: dataUrl,
          to,
          note,
        });
      } catch {
        toast.error("메일 전송 실패 — 잠시 후 다시 시도하세요.");
        return;
      }
      if (r.ok) {
        if (r.warning) toast.warning(r.warning);
        else toast.success("명세서 메일 전송됨");
        setMailOpen(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  function handleSend() {
    if (!captureRef.current) return;
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
      const r = await sendSiteStatementSms(siteId, book, dataUrl, phone, company?.name ?? undefined);
      if (r.ok) {
        toast.success("명세서 문자(MMS) 전송됨");
        setSmsOpen(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <section className="bg-zinc-100 px-4 py-6 dark:bg-zinc-900 print:bg-white print:p-0">
      {/* 캡처 대상: 800px 고정(단건 명세표와 같은 비율) — 좁은 화면은 가로 스크롤, 프린트는 폭 해제. */}
      <div className="overflow-x-auto print:overflow-visible">
        <div
          ref={captureRef}
          className="mx-auto w-[800px] rounded-md bg-white p-6 text-zinc-900 shadow-md print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none"
        >
          <TradingStatement data={data} company={company} recipientOnly />
        </div>
      </div>

      {/* 문자 전송 — 인라인 수신번호(펼침) */}
      <div className="mx-auto mt-3 max-w-[800px] print:hidden">
        {smsOpen ? (
          <div className="flex items-end gap-2 rounded-lg border bg-card p-3">
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
            <Button onClick={handleSend} disabled={pending}>
              {pending ? "전송 중..." : "전송"}
            </Button>
            <Button variant="ghost" onClick={() => setSmsOpen(false)} disabled={pending}>
              취소
            </Button>
          </div>
        ) : mail && mailOpen ? (
          <MailSendPanel defaultTo={mail.defaultTo} pending={pending} onSend={handleSendMail} onCancel={() => setMailOpen(false)} />
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={openSms}>
              <SendIcon className="size-4" /> 문자 전송
            </Button>
            {mail ? (
              <MailButton
                status={mail.status}
                onClick={() => {
                  setSmsOpen(false);
                  setMailOpen(true);
                }}
              />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
