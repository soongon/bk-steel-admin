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
import { type Book } from "@/lib/book";
import { type CompanyProfile } from "@/lib/company-profile";
import { type DeliveryCertificate } from "@/lib/delivery-certificate";
import {
  DeliveryCertForm,
  type DeliveryCertData,
} from "@/components/admin/delivery-cert-form";
import { issueDeliveryCertBySite } from "@/app/[book]/sites/[id]/cert-actions";

export function DeliveryCertButton({
  book,
  partnerId,
  siteId,
  cert,
  formData,
  company,
}: {
  book: Book;
  partnerId: string | null;
  siteId: string | null;
  cert: DeliveryCertificate | null;
  formData: DeliveryCertData | null;
  company: CompanyProfile | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // 현장 미지정 매출 — 발급 불가
  if (!siteId || !partnerId) {
    return (
      <Button variant="outline" size="sm" disabled title="현장 지정 후 발급 가능">
        <FileSignatureIcon className="size-4" />
        납품확인서 (현장 미지정)
      </Button>
    );
  }

  function handleIssue() {
    if (!siteId || !partnerId) return;
    startTransition(async () => {
      const r = await issueDeliveryCertBySite(book, partnerId, siteId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.already_existed
          ? `기존 확인서 ${r.doc_no} 에 연결되었습니다`
          : `납품확인서 ${r.doc_no} 발급 완료`,
      );
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
        <DialogContent className="!max-w-[920px] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="print:hidden">
            <DialogTitle className="flex items-center gap-2">
              <FileSignatureIcon className="size-5" />
              납품확인서 {cert ? `· ${cert.doc_no}` : "미리보기"}
            </DialogTitle>
            <DialogDescription>
              {cert
                ? `${cert.issued_on} 발급됨 — 인쇄·재인쇄 가능`
                : "발급 확정 전 미리보기 — 동일 거래처·현장의 모든 매출이 1장에 누적됩니다"}
            </DialogDescription>
          </DialogHeader>

          <div className="bg-zinc-100 p-3 print:bg-white print:p-0 dark:bg-zinc-900">
            <div className="mx-auto max-w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
              {formData ? (
                <DeliveryCertForm data={formData} company={company} />
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  양식 데이터를 불러올 수 없습니다.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setOpen(false)}>
              닫기
            </Button>
            {cert ? (
              <Button onClick={() => window.print()}>
                <PrinterIcon className="size-4" />
                인쇄
              </Button>
            ) : (
              <Button onClick={handleIssue} disabled={pending || !formData}>
                {pending ? "발급 중..." : "발급 확정"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
