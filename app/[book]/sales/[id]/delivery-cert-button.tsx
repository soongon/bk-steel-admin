"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, FileSignatureIcon, PrinterIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type DeliveryCertificate } from "@/lib/delivery-certificate";
import { issueDeliveryCertificate } from "./cert-actions";

export function DeliveryCertButton({
  saleId,
  cert,
  partnerName,
  siteName,
}: {
  saleId: string;
  cert: DeliveryCertificate | null;
  partnerName: string;
  siteName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleIssue() {
    startTransition(async () => {
      const r = await issueDeliveryCertificate(saleId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.already_existed
          ? `기존 확인서 ${r.doc_no} 에 연결되었습니다`
          : `납품확인서 ${r.doc_no} 발급 완료`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant={cert ? "secondary" : "default"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {cert ? (
          <>
            <CheckCircle2Icon className="size-4" />
            납품확인서 보기
          </>
        ) : (
          <>
            <FileSignatureIcon className="size-4" />
            납품확인서 발급
          </>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignatureIcon className="size-5" />
              납품확인서 {cert ? `· ${cert.doc_no}` : "발급"}
            </DialogTitle>
            <DialogDescription>
              {partnerName}
              {siteName ? <span className="ml-1 font-medium">/ {siteName}</span> : null}
              {cert ? (
                <span className="ml-2 text-xs">
                  · {cert.issued_on} 발급됨
                </span>
              ) : (
                <span className="ml-2 text-xs">
                  · 거래처+현장 단위로 1회 발급 — 이 거래처·현장의 모든 납품 매출이 1장에 묶입니다
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* 양식 placeholder — 실제 양식은 다음 단계 */}
          <div className="rounded-md border-2 border-dashed border-zinc-300 bg-zinc-50 p-12 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
            <p className="text-base font-semibold text-foreground">
              납품확인서 양식 (구현 예정)
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              거래처별 납품 내역 집계 + 사업자 인감 첨부 양식은 다음 단계에서 구현합니다.
            </p>
            {cert ? (
              <dl className="mt-6 inline-grid grid-cols-2 gap-x-4 gap-y-1 text-left text-xs">
                <dt className="text-muted-foreground">문서번호</dt>
                <dd className="font-mono">{cert.doc_no}</dd>
                <dt className="text-muted-foreground">발급일</dt>
                <dd>{cert.issued_on}</dd>
                <dt className="text-muted-foreground">거래처</dt>
                <dd>{partnerName}</dd>
                <dt className="text-muted-foreground">현장</dt>
                <dd>{siteName ?? <span className="text-muted-foreground">— (미지정)</span>}</dd>
              </dl>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              닫기
            </Button>
            {cert ? (
              <Button onClick={() => window.print()}>
                <PrinterIcon className="size-4" />
                인쇄
              </Button>
            ) : (
              <Button onClick={handleIssue} disabled={pending}>
                {pending ? "발급 중..." : "발급 확정"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
