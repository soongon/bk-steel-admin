"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { type CompanyProfile } from "@/lib/company-profile";
import { digitsOnly } from "@/lib/format";
import { sendStatementSms } from "./sms-actions";

/**
 * 명세서 MMS 전송 — html2canvas 로 명세서를 이미지(JPEG)로 캡처해 거래처 휴대폰으로 전송.
 * StatementButton 과 동일하게 data·company 를 받아 같은 명세서를 렌더(캡처 대상).
 */
export function SmsButton({
  saleId,
  data,
  company,
  defaultPhone,
  siteName,
}: {
  saleId: string;
  data: StatementData;
  company: CompanyProfile | null;
  defaultPhone?: string | null;
  siteName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [pending, startTransition] = useTransition();
  const captureRef = useRef<HTMLDivElement>(null);

  async function handleSend() {
    if (!captureRef.current) return;
    if (digitsOnly(phone).length < 10) {
      toast.error("수신 번호를 확인하세요.");
      return;
    }
    let dataUrl: string;
    try {
      // 브라우저 전용 — 동적 import 로 SSR 회피
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(captureRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
      });
      dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    } catch {
      toast.error("명세서 이미지 생성 실패");
      return;
    }
    startTransition(async () => {
      const r = await sendStatementSms(saleId, dataUrl, phone, siteName);
      if (r.ok) {
        toast.success("명세서 문자(MMS) 전송됨");
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
        <SendIcon className="size-4" /> 문자 전송
      </Button>

      {open ? (
        <Dialog open onOpenChange={(o) => { if (!o) setOpen(false); }}>
          <DialogContent className="!max-w-[640px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>명세서 문자 전송 (MMS)</DialogTitle>
              <DialogDescription>
                아래 명세서가 이미지로 캡처되어 전송됩니다.
              </DialogDescription>
            </DialogHeader>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">수신 번호 *</span>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                inputMode="numeric"
              />
              {!defaultPhone ? (
                <span className="text-xs text-amber-600">
                  거래처에 등록된 휴대폰이 없습니다 — 직접 입력하세요
                </span>
              ) : null}
            </label>

            {/* 캡처 대상 = 미리보기. 흰 배경·zinc 텍스트로 이미지 가독성 확보 */}
            <div className="rounded border bg-zinc-100 p-2">
              <div ref={captureRef} className="mx-auto max-w-[560px] bg-white p-4 text-zinc-900">
                <TradingStatement data={data} company={company} recipientOnly />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                취소
              </Button>
              <Button onClick={handleSend} disabled={pending}>
                {pending ? "전송 중..." : "전송"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
