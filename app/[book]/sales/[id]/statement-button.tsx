"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheetIcon, PrinterIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { type CompanyProfile } from "@/lib/company-profile";
import { digitsOnly } from "@/lib/format";
import { sendStatementSms } from "./sms-actions";

/**
 * 거래명세표 — 버튼으로 모달 열기(공급받는자 보관용 1매).
 * sms 를 넘기면 모달 하단에 문자(MMS) 전송 기능이 노출된다 — 모달의 명세표 DOM 을
 * html2canvas-pro 로 캡처해 거래처 휴대폰으로 전송. (별도 SmsButton 을 흡수한 통합본)
 */
export function StatementButton({
  data,
  company,
  sms,
}: {
  data: StatementData;
  company: CompanyProfile | null;
  sms?: { saleId: string; defaultPhone?: string | null; siteName?: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const captureRef = useRef<HTMLDivElement>(null);

  // 수신번호·현장명 기본값: 명시 prop > statementData fallback
  const defaultPhone = sms?.defaultPhone ?? data.partner.phone ?? "";
  const siteName = sms?.siteName ?? data.site_name ?? undefined;

  function openSms() {
    setPhone(defaultPhone);
    setSmsOpen(true);
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
        // 브라우저 전용 — html2canvas-pro 는 Tailwind4 oklch 색상을 파싱(원조 html2canvas 는 실패).
        const html2canvas = (await import("html2canvas-pro")).default;
        const canvas = await html2canvas(node, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
          imageTimeout: 15000,
        });
        // 1600px(800×2)는 MMS 권장 가로(~1500px) 초과 가능 → 1400px 이하로 다운스케일
        const MAX_W = 1400;
        let out = canvas;
        if (canvas.width > MAX_W) {
          const scaled = document.createElement("canvas");
          scaled.width = MAX_W;
          scaled.height = Math.round((canvas.height * MAX_W) / canvas.width);
          scaled.getContext("2d")?.drawImage(canvas, 0, 0, scaled.width, scaled.height);
          out = scaled;
        }
        dataUrl = out.toDataURL("image/jpeg", 0.85);
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
            if (!o) {
              setOpen(false);
              setSmsOpen(false);
            }
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
              <Button variant="outline" onClick={() => setOpen(false)}>
                닫기
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <PrinterIcon className="size-4" /> 프린트
              </Button>
              {sms && !smsOpen ? (
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
