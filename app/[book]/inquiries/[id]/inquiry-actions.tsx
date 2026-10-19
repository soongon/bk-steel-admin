"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2Icon, FileTextIcon, ScaleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type BookView } from "@/lib/book";
import { INQUIRY_STATUSES, type InquiryStatus } from "@/lib/inquiry";
import { QuoteDialog, type QuoteSources } from "@/components/admin/quote-dialog";
import {
  PurchaseQuoteDialog,
  type PurchaseQuoteDefaults,
  type PurchaseQuoteSources,
} from "@/components/admin/purchase-quote-dialog";
import { PartnerFormDialog, type PartnerPrefill } from "@/app/[book]/partners/partner-form-dialog";
import { markInquiryHandled, updateInquiryStatus } from "../actions";

/** 상태 3단(새 문의·확인·완료) — 지금 상태는 눌린 모양. 바꾸면 메뉴의 새 문의 배지도 같이 바뀐다. */
export function InquiryStatusButtons({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  function change(next: InquiryStatus, label: string) {
    if (next === status) return;
    startTransition(async () => {
      const r = await updateInquiryStatus(id, next);
      if (r.ok) toast.success(`상태: ${label}`);
      else toast.error(r.error);
    });
  }
  return (
    <div className="flex items-center gap-1" role="group" aria-label="문의 상태">
      {INQUIRY_STATUSES.map((s) => {
        const on = s.value === status;
        return (
          <Button
            key={s.value}
            type="button"
            size="sm"
            variant={on ? "default" : "outline"}
            aria-pressed={on}
            disabled={pending}
            onClick={() => change(s.value, s.label)}
          >
            {s.label}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * 문의 → 견적서·매입견적서·거래처 등록. 문의 구분에 맞는 견적(매입 문의 = 매입견적서)을 앞에 둔다.
 * 견적은 저장되면 문의를 '확인'으로 바꾸고 견적 상세로 간다(바로 문자·인쇄).
 */
export function InquiryActions({
  inquiryId,
  view,
  kind,
  quoteSources,
  pqSources,
  pqDefaults,
  quotePartnerName,
  siteName,
  reference,
  partnerPrefill,
}: {
  inquiryId: string;
  view: BookView;
  kind: "purchase" | "sale" | null;
  quoteSources: QuoteSources;
  pqSources: PurchaseQuoteSources;
  pqDefaults: PurchaseQuoteDefaults;
  quotePartnerName: string;
  siteName: string;
  reference: string | null;
  /** 같은 번호 거래처가 없을 때만 — 있으면 [거래처 등록]을 숨긴다. */
  partnerPrefill: PartnerPrefill | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"quote" | "pq" | "partner" | null>(null);
  // 저장 뒤 견적 상세로 옮겨 가는 동안 견적 폼(미리보기 포함)을 내려 둔다 — [저장]을 한 번 더 누를 틈을 없앤다.
  const [leaving, setLeaving] = useState(false);

  async function afterQuoteSaved(path: string) {
    setLeaving(true);
    const r = await markInquiryHandled(inquiryId);
    if (!r.ok) toast.error(`견적은 저장됐지만 문의 상태를 바꾸지 못했습니다: ${r.error}`);
    router.push(path);
  }

  const pqButton = (
    <Button key="pq" size="sm" variant={kind === "sale" ? "outline" : "default"} disabled={leaving} onClick={() => setOpen("pq")}>
      <ScaleIcon /> 매입견적서 작성
    </Button>
  );
  const quoteButton = (
    <Button key="quote" size="sm" variant={kind === "sale" ? "default" : "outline"} disabled={leaving} onClick={() => setOpen("quote")}>
      <FileTextIcon /> 견적서 작성
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {kind === "sale" ? [quoteButton, pqButton] : [pqButton, quoteButton]}
      {partnerPrefill ? (
        <Button size="sm" variant="outline" onClick={() => setOpen("partner")}>
          <Building2Icon /> 거래처 등록
        </Button>
      ) : null}

      {!leaving ? (
        <>
          <PurchaseQuoteDialog
            open={open === "pq"}
            onOpenChange={(o) => setOpen(o ? "pq" : null)}
            sources={pqSources}
            book={view}
            defaults={pqDefaults}
            onSaved={(id) => (id ? afterQuoteSaved(`/${view}/purchase-quotes/${id}`) : router.refresh())}
          />
          <QuoteDialog
            open={open === "quote"}
            onOpenChange={(o) => setOpen(o ? "quote" : null)}
            sources={quoteSources}
            book={view}
            defaultPartnerName={quotePartnerName}
            defaultSiteName={siteName}
            reference={reference}
            onSaved={(id) => (id ? afterQuoteSaved(`/${view}/quotes/${id}`) : router.refresh())}
          />
        </>
      ) : null}
      {partnerPrefill ? (
        <PartnerFormDialog
          open={open === "partner"}
          onOpenChange={(o) => setOpen(o ? "partner" : null)}
          editing={null}
          prefill={partnerPrefill}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
