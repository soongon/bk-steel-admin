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
import { issueDeliveryCertBySite } from "./cert-actions";

export function SiteCertButton({
  book,
  partnerId,
  siteId,
  cert,
  formData,
  company,
}: {
  book: Book;
  partnerId: string;
  siteId: string;
  cert: DeliveryCertificate | null;
  formData: DeliveryCertData;
  company: CompanyProfile | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleIssue() {
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
                : "발급 확정 전 미리보기 — 1회 발급 후 동일 거래처·현장 재발급 불가"}
            </DialogDescription>
          </DialogHeader>

          {/* A4 종이 느낌 */}
          <div className="bg-zinc-100 p-3 print:bg-white print:p-0 dark:bg-zinc-900">
            <div className="mx-auto max-w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
              <DeliveryCertForm data={formData} company={company} />
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
