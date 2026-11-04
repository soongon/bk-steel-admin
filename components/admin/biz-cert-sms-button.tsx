"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FileBadgeIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormattedInput } from "@/components/admin/formatted-input";
import { type BookView } from "@/lib/book";
import { digitsOnly, formatPhone } from "@/lib/format";
import { imageUrlToJpeg } from "@/lib/capture-node";
import { sendBizCertSms } from "@/app/[book]/biz-cert-sms-actions";

/**
 * 매출·매입 상세 머리 [사업자등록증] — 모달에서 우리 등록증을 보고 거래처 휴대폰으로 문자(MMS) 전송.
 * 등록증이 없는 책(bk 등)은 설정 > 회사 정보로 안내. 이미지는 공개 URL 을 브라우저에서 200KB 이하 JPEG 로 줄여 보낸다.
 */
export function BizCertSmsButton({
  parent,
  parentId,
  view,
  certUrl,
  companyName,
  defaultPhone,
}: {
  parent: "sale" | "purchase";
  parentId: string;
  view: BookView;
  certUrl: string | null;
  companyName: string;
  /** 거래처 휴대폰(숫자만 저장) — 없으면 직접 입력 */
  defaultPhone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(defaultPhone ? formatPhone(defaultPhone) : "");
  const [pending, startTransition] = useTransition();

  function send() {
    if (!certUrl) return;
    if (digitsOnly(phone).length < 10) {
      toast.error("수신 번호를 확인하세요.");
      return;
    }
    startTransition(async () => {
      let dataUrl: string;
      try {
        dataUrl = await imageUrlToJpeg(certUrl); // 200KB 이하 자동 압축
      } catch {
        toast.error("사업자등록증 이미지를 읽지 못했습니다.");
        return;
      }
      let r: Awaited<ReturnType<typeof sendBizCertSms>>;
      try {
        r = await sendBizCertSms(parent, parentId, dataUrl, phone);
      } catch {
        toast.error("전송 실패 — 잠시 후 다시 시도하세요.");
        return;
      }
      if (r.ok) {
        toast.success(`사업자등록증 문자(MMS) 전송됨 · ${formatPhone(digitsOnly(phone))}`);
        setOpen(false);
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileBadgeIcon className="size-4" /> 사업자등록증
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="!max-w-[min(32rem,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>사업자등록증 문자 전송</DialogTitle>
            <DialogDescription>
              {certUrl ? `${companyName} 사업자등록증을 거래처 휴대폰으로 보냅니다(MMS).` : "등록된 사업자등록증이 없습니다."}
            </DialogDescription>
          </DialogHeader>

          {certUrl ? (
            <>
              <a href={certUrl} target="_blank" rel="noopener noreferrer" title="원본 보기" className="block overflow-hidden rounded-md border bg-white">
                {/* crossOrigin: 전송 때 같은 URL 을 CORS 로 다시 읽어 canvas 에 그린다 — 미리보기도 CORS 로 받아 캐시가 섞이지 않게 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={certUrl} crossOrigin="anonymous" alt={`${companyName} 사업자등록증`} className="mx-auto max-h-72 object-contain" />
              </a>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">수신 번호 *</span>
                <FormattedInput format="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" autoFocus={!defaultPhone} />
                {!defaultPhone ? <span className="text-xs text-amber-600">거래처 휴대폰이 없습니다 — 직접 입력</span> : null}
              </label>
            </>
          ) : (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <Link href={`/${view}/settings/company`} className="underline underline-offset-2">
                설정 › 회사 정보
              </Link>
              에서 {companyName} 사업자등록증 이미지를 먼저 올려 주세요.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              닫기
            </Button>
            {certUrl ? (
              <Button type="button" disabled={pending} onClick={send}>
                <SendIcon className="size-4" /> {pending ? "전송 중..." : "문자 전송"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
