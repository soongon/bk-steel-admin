"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeftIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Book } from "@/lib/book";
import { TAX_DOC_OPTIONS } from "@/lib/tax-doc";
import { convertQuoteToSale } from "../actions";

/**
 * 견적 상세의 '수주 전환' — 견적을 매출로 전환(convert_quote_to_sale RPC).
 * 거래처: 견적에 있으면 고정, 없으면(잠재 고객) 마스터에서 선택 필수.
 * 세금: 견적 자료성(isDocumented)에 따라 — 자료면 책별 옵션, 무자료면 none 고정.
 */
export function QuoteConvertButton({
  quoteId,
  book,
  status,
  partnerName,
  partners,
  isDocumented,
}: {
  quoteId: string;
  book: Book;
  status: string;
  partnerName: string | null; // 견적의 거래처(있으면 고정)
  partners: { id: string; name: string }[]; // 없을 때 선택 후보
  isDocumented: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  const [partnerInput, setPartnerInput] = useState(partnerName ?? "");
  const matchedPartner = partners.find((p) => p.name === partnerInput);
  const [taxDocType, setTaxDocType] = useState(isDocumented ? "tax_invoice_electronic" : "none");
  const [orderedOn, setOrderedOn] = useState(today);
  const [deliveredOn, setDeliveredOn] = useState("");
  const [paymentDueOn, setPaymentDueOn] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (status === "won") {
    return <span className="text-xs font-medium text-emerald-600">수주 전환됨</span>;
  }

  // 세금 옵션 — 매출 폼과 동일 책별 정책.
  const taxOptions = isDocumented
    ? TAX_DOC_OPTIONS.filter((o) => {
        if (book === "bk") return o.value !== "none" && o.value !== "simple_receipt";
        if (book === "b") return o.value === "none";
        return true;
      })
    : TAX_DOC_OPTIONS.filter((o) => o.value === "none");

  function onConvert() {
    setError(null);
    if (!partnerName && !matchedPartner) {
      setError("거래처를 마스터에 등록된 이름으로 선택하세요.");
      return;
    }
    const fd = new FormData();
    fd.set("quote_id", quoteId);
    fd.set("book", book);
    if (!partnerName && matchedPartner) fd.set("partner_id", matchedPartner.id);
    fd.set("tax_doc_type", taxDocType);
    fd.set("ordered_on", orderedOn);
    fd.set("delivered_on", deliveredOn);
    fd.set("payment_due_on", paymentDueOn);
    fd.set("status", "reserved");
    start(async () => {
      const r = await convertQuoteToSale(fd);
      if (r.ok) {
        toast.success("수주(매출)로 전환되었습니다");
        router.push(`/${book}/sales/${r.saleId}`);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <>
      <Button variant="default" size="sm" onClick={() => setOpen(true)}>
        <ArrowRightLeftIcon className="size-4" /> 수주 전환
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>수주 전환</DialogTitle>
            <DialogDescription>
              이 견적을 매출로 전환합니다. 품목·금액은 견적 그대로 복사되고, 거래처·세금·날짜만 확정합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Field label="거래처 *">
              {partnerName ? (
                <div className="flex h-8 items-center rounded-md border bg-muted/30 px-2 text-sm font-medium">
                  {partnerName}
                </div>
              ) : (
                <>
                  <Input
                    list="convert-partners"
                    value={partnerInput}
                    onChange={(e) => setPartnerInput(e.target.value)}
                    placeholder="거래처 선택 (마스터 등록 필요)"
                  />
                  <datalist id="convert-partners">
                    {partners.map((p) => (
                      <option key={p.id} value={p.name} />
                    ))}
                  </datalist>
                  {partnerInput && !matchedPartner ? (
                    <p className="mt-0.5 text-[10px] text-amber-600">
                      마스터 미등록 — 거래처 페이지에서 먼저 등록하세요
                    </p>
                  ) : null}
                </>
              )}
            </Field>

            <Field label="세금계산서">
              <select
                value={taxDocType}
                onChange={(e) => setTaxDocType(e.target.value)}
                disabled={!isDocumented}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
              >
                {taxOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {!isDocumented ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">무자료 견적 — 세금계산서 없음</p>
              ) : null}
            </Field>

            <div className="grid grid-cols-3 gap-2">
              <Field label="주문일">
                <Input type="date" value={orderedOn} onChange={(e) => setOrderedOn(e.target.value)} />
              </Field>
              <Field label="납품일">
                <Input type="date" value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} />
              </Field>
              <Field label="수금예정">
                <Input type="date" value={paymentDueOn} onChange={(e) => setPaymentDueOn(e.target.value)} />
              </Field>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button onClick={onConvert} disabled={pending}>
              {pending ? "전환 중..." : "매출로 전환"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
