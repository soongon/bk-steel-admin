"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ReceiptTextIcon, FileTextIcon, RefreshCwIcon, XCircleIcon } from "lucide-react";
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
import { type StatementData } from "@/components/admin/trading-statement";
import { TaxInvoiceDocument } from "@/components/admin/tax-invoice-document";
import { type CompanyProfile } from "@/lib/company-profile";
import { TAX_INVOICE_STATE_KO, type TaxDocMode, type TaxInvoiceState } from "@/lib/tax-invoice";
import { digitsOnly } from "@/lib/format";
import {
  issueSaleTaxInvoice,
  cancelSaleTaxInvoice,
  refreshTaxInvoiceStatus,
  getTaxInvoicePrintUrl,
  recordManualTaxInvoice,
} from "./tax-invoice-actions";

export type SaleTaxInvoice = {
  state: TaxInvoiceState;
  nts_confirm_num: string | null;
  provider: string;
  write_date: string | null;
};

/** 발행 대상 거래처 선택용(하청 등으로 납품처와 발행처가 다를 때). */
export type BuyerPartner = {
  id: string;
  name: string;
  business_no: string | null;
  representative: string | null;
  address: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
};

const STATE_BADGE: Record<TaxInvoiceState, string> = {
  draft: "bg-muted text-muted-foreground",
  issuing: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  issued: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  nts_sent: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  nts_approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  cancelled: "bg-zinc-200 text-zinc-600",
};

/**
 * 매출 세금계산서 — 상태별 단일 진입점.
 *  - 전자(electronic): 발행 모달(작성일자·청구/영수·비고·거래처 사업자정보 보강) → ASP 실발행.
 *  - 수기(manual): 종이/면세계산서 번호 기록.
 *  - 발행됨: 승인번호·상태 + 원본 PDF·상태 새로고침·발행취소.
 *  - none(무자료/B/현금영수증/간이): 렌더 안 함.
 */
export function TaxInvoiceButton({
  saleId,
  mode,
  taxInvoice,
  statementData,
  company,
  partners = [],
  defaultBuyerPartnerId = null,
}: {
  saleId: string;
  mode: TaxDocMode;
  taxInvoice: SaleTaxInvoice | null;
  statementData: StatementData;
  company: CompanyProfile | null;
  partners?: BuyerPartner[];
  defaultBuyerPartnerId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const [writeDate, setWriteDate] = useState(statementData.ordered_on || today);
  const [purpose, setPurpose] = useState<"charge" | "receipt">("charge");
  const [remark, setRemark] = useState("");
  const [buyerPartnerId, setBuyerPartnerId] = useState(defaultBuyerPartnerId ?? "");
  const [bizNo, setBizNo] = useState(statementData.partner.business_no ?? "");
  const [ceo, setCeo] = useState(statementData.partner.representative ?? "");
  const [email, setEmail] = useState(statementData.partner.email ?? "");
  const [manualNo, setManualNo] = useState("");

  // 발행 상태 자동 새로고침 — 국세청 승인번호는 팝빌 배치로 뒤늦게 부여된다. 승인 대기(issued/
  // issuing/nts_sent)면 상세를 보는 동안 자동 폴링해 승인번호를 반영(수동 [상태 새로고침] 불필요).
  // 상태가 실제로 바뀔 때만 router.refresh() → 무한 루프 방지. 승인/실패/취소면 폴링 종료.
  const taxState = taxInvoice?.state;
  const taxProvider = taxInvoice?.provider;
  useEffect(() => {
    if (!taxState || taxProvider === "manual") return;
    if (!["issuing", "issued", "nts_sent"].includes(taxState)) return;
    let cancelled = false;
    let tries = 0;
    const poll = async () => {
      if (cancelled) return;
      tries += 1;
      const r = await refreshTaxInvoiceStatus(saleId);
      if (!cancelled && r.ok && r.state && r.state !== taxState) router.refresh();
    };
    void poll(); // 즉시 1회
    const iv = setInterval(() => {
      if (cancelled || tries >= 20) {
        clearInterval(iv); // 최대 ~10분(20×30s) 후 종료
        return;
      }
      void poll();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [taxState, taxProvider, saleId, router]);

  const buyerPartner = partners.find((p) => p.id === buyerPartnerId) ?? null;
  const buyerDiffers = !!defaultBuyerPartnerId && buyerPartnerId !== defaultBuyerPartnerId;

  // 발행 대상 거래처 변경 시 사업자정보 자동 채움(수동 수정 가능).
  function onBuyerChange(id: string) {
    setBuyerPartnerId(id);
    const p = partners.find((x) => x.id === id);
    if (p) {
      setBizNo(p.business_no ?? "");
      setCeo(p.representative ?? "");
      setEmail(p.email ?? "");
    }
  }

  // 미리보기·발행에 반영할 공급받는자(선택 거래처 + 수동 보강값).
  const previewData: StatementData = {
    ...statementData,
    partner: {
      ...statementData.partner,
      name: buyerPartner?.name ?? statementData.partner.name,
      business_no: digitsOnly(bizNo) || buyerPartner?.business_no || statementData.partner.business_no,
      representative: ceo || buyerPartner?.representative || statementData.partner.representative,
      address: buyerPartner?.address ?? statementData.partner.address,
      industry: buyerPartner?.industry ?? statementData.partner.industry,
      email: email || buyerPartner?.email || statementData.partner.email,
      phone: buyerPartner?.phone ?? statementData.partner.phone,
    },
  };

  if (mode === "none") return null;
  const has = !!taxInvoice;

  function onIssue() {
    if (!digitsOnly(bizNo)) {
      toast.error("거래처 사업자등록번호를 입력하세요.");
      return;
    }
    start(async () => {
      const r = await issueSaleTaxInvoice(saleId, {
        writeDate,
        purpose,
        remark: remark || undefined,
        buyerPartnerId: buyerPartnerId || undefined,
        buyerBusinessNo: bizNo,
        buyerCeoName: ceo || undefined,
        buyerEmail: email || undefined,
      });
      if (r.ok) {
        toast.success(`세금계산서 발행됨${r.ntsConfirmNum ? ` · 승인 ${r.ntsConfirmNum}` : ""}`);
        setOpen(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }
  function onManual() {
    if (!manualNo.trim()) {
      toast.error("세금계산서 번호를 입력하세요.");
      return;
    }
    start(async () => {
      const r = await recordManualTaxInvoice(saleId, { taxDocNo: manualNo, writeDate });
      if (r.ok) {
        toast.success("세금계산서 기록됨");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }
  function onRefresh() {
    start(async () => {
      const r = await refreshTaxInvoiceStatus(saleId);
      if (r.ok) {
        toast.success(`상태: ${r.state ? TAX_INVOICE_STATE_KO[r.state as TaxInvoiceState] : "갱신됨"}`);
        router.refresh();
      } else toast.error(r.error);
    });
  }
  function onPdf() {
    start(async () => {
      const r = await getTaxInvoicePrintUrl(saleId);
      if (r.ok) window.open(r.url, "_blank", "noopener");
      else toast.error(r.error);
    });
  }
  function onCancel() {
    const reason = window.prompt("발행취소 사유를 입력하세요", "거래 취소");
    if (reason === null) return;
    start(async () => {
      const r = await cancelSaleTaxInvoice(saleId, reason);
      if (r.ok) {
        toast.success("발행취소됨");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <>
      <Button
        size="xs"
        variant={has ? "secondary" : "outline"}
        onClick={() => setOpen(true)}
      >
        <ReceiptTextIcon className="size-3.5" />
        {has ? "계산서" : mode === "electronic" ? "발행" : "계산서 기록"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="!max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {has ? "세금계산서" : mode === "electronic" ? "전자세금계산서 발행" : "세금계산서 기록"}
            </DialogTitle>
            <DialogDescription>
              {has
                ? "발행된 세금계산서 — 상태 조회·원본 PDF·발행취소."
                : mode === "electronic"
                  ? "국세청 전자세금계산서를 발행합니다(공급받는자 이메일로 자동 전송)."
                  : "종이·면세계산서 번호를 기록합니다(발행은 외부에서)."}
            </DialogDescription>
          </DialogHeader>

          {has ? (
            <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">상태</span>
                <span className="flex items-center gap-1.5">
                  {["issuing", "issued", "nts_sent"].includes(taxInvoice!.state) ? (
                    <span className="text-[10px] text-muted-foreground">승인 대기 · 자동 확인 중</span>
                  ) : null}
                  <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${STATE_BADGE[taxInvoice!.state]}`}>
                    {TAX_INVOICE_STATE_KO[taxInvoice!.state]}
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">승인번호</span>
                <span className="font-mono text-xs">{taxInvoice!.nts_confirm_num ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">작성일자</span>
                <span className="font-mono text-xs">{taxInvoice!.write_date ?? "—"}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={onPdf} disabled={pending}>
                  <FileTextIcon className="size-4" /> 원본 PDF
                </Button>
                <Button size="sm" variant="outline" onClick={onRefresh} disabled={pending}>
                  <RefreshCwIcon className="size-4" /> 상태 새로고침
                </Button>
                <Button size="sm" variant="outline" onClick={onCancel} disabled={pending} className="text-destructive">
                  <XCircleIcon className="size-4" /> 발행취소
                </Button>
              </div>
            </div>
          ) : mode === "electronic" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="공급받는자(발행 거래처)">
                  <select
                    value={buyerPartnerId}
                    onChange={(e) => onBuyerChange(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {defaultBuyerPartnerId && !partners.some((p) => p.id === defaultBuyerPartnerId) ? (
                      <option value={defaultBuyerPartnerId}>{statementData.partner.name} (매출 거래처)</option>
                    ) : null}
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.business_no ? ` · ${p.business_no}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                {buyerDiffers ? (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                    납품 거래처와 다른 곳으로 발행합니다(하청 등). 매출의 거래처는 바뀌지 않습니다.
                  </p>
                ) : null}
              </div>
              <Field label="작성일자">
                <Input type="date" value={writeDate} onChange={(e) => setWriteDate(e.target.value)} />
              </Field>
              <Field label="청구/영수">
                <div className="flex gap-1">
                  {(["charge", "receipt"] as const).map((p) => (
                    <Button
                      key={p}
                      type="button"
                      size="sm"
                      variant={purpose === p ? "default" : "outline"}
                      onClick={() => setPurpose(p)}
                      className="flex-1"
                    >
                      {p === "charge" ? "청구" : "영수"}
                    </Button>
                  ))}
                </div>
              </Field>
              <Field label="거래처 사업자등록번호 *">
                <Input value={bizNo} onChange={(e) => setBizNo(e.target.value)} placeholder="숫자 10자리" inputMode="numeric" />
              </Field>
              <Field label="거래처 대표자">
                <Input value={ceo} onChange={(e) => setCeo(e.target.value)} />
              </Field>
              <Field label="거래처 이메일(전송)">
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="buyer@example.com" />
              </Field>
              <Field label="비고">
                <Input value={remark} onChange={(e) => setRemark(e.target.value)} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="세금계산서 번호 *">
                <Input value={manualNo} onChange={(e) => setManualNo(e.target.value)} placeholder="승인번호 또는 발행번호" />
              </Field>
              <Field label="작성일자">
                <Input type="date" value={writeDate} onChange={(e) => setWriteDate(e.target.value)} />
              </Field>
            </div>
          )}

          <details className="rounded-lg border bg-muted/20 p-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">세금계산서 미리보기</summary>
            <div className="mt-2 overflow-x-auto bg-white p-3">
              <div className="mx-auto w-[760px]">
                <TaxInvoiceDocument
                  data={previewData}
                  company={company}
                  purpose={purpose}
                  writeDate={writeDate}
                  ntsConfirmNum={taxInvoice?.nts_confirm_num}
                />
              </div>
            </div>
          </details>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              닫기
            </Button>
            {!has && mode === "electronic" ? (
              <Button onClick={onIssue} disabled={pending}>
                {pending ? "발행 중..." : "발행"}
              </Button>
            ) : null}
            {!has && mode === "manual" ? (
              <Button onClick={onManual} disabled={pending}>
                {pending ? "기록 중..." : "기록"}
              </Button>
            ) : null}
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
