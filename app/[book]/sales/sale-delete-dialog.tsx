"use client";

import { useEffect, useState, useTransition } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { Loader2Icon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { BookBadge } from "@/components/admin/book-badge";
import { fmtKrw } from "@/lib/format";
import { TAX_INVOICE_STATE_KO } from "@/lib/tax-invoice";
import {
  deleteSaleWithOptions,
  getSaleDeleteImpact,
  type SaleDeleteCandidate,
  type SaleDeleteImpact,
} from "./delete-actions";

const STATUS_KO: Record<string, string> = {
  reserved: "주문",
  confirmed: "확정",
  delivered: "납품완료",
  settled: "수금완료",
  overdue: "연체",
  cancelled: "취소",
};
const PROVIDER_KO: Record<string, string> = {
  popbill: "팝빌 전자발행",
  hometax: "홈택스 발행",
  manual: "수기 기록",
  mock: "시험 발행",
};

function actionError(e: unknown): string {
  return unstable_isUnrecognizedActionError(e)
    ? "새 버전이 배포됐습니다 — 새로고침한 뒤 다시 해 주세요."
    : "요청이 실패했습니다 — 연결을 확인하고 다시 해 주세요.";
}

function candidateLabel(c: SaleDeleteCandidate): string {
  return [
    c.doc_no,
    c.ordered_on,
    c.same_partner ? null : c.partner_name,
    fmtKrw(c.total_krw),
    STATUS_KO[c.status] ?? c.status,
    c.received_krw > 0 && c.status !== "settled" ? `입금 ${fmtKrw(c.received_krw)}` : null,
    c.has_invoice ? "계산서 있음" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 매출 삭제 — 지우기 전에 딸린 것(수금 기록·발행된 계산서·홈택스 연결·재고 출고·견적)을 보여 주고 처리 방법을 고르게 한다.
 * 합치기·다시 만들기는 대상 매출(합친·새로 만든 매출)을 골라 수금·계산서를 옮기고 연결 기록을 남긴다.
 * 아니면 수금 기록을 지우고, 발행된 계산서는 국세청 기록으로 남긴다(세금계산서 화면 '정리 필요').
 * 목록·상세 공용. 실제 처리는 delete_sale RPC 한 번(0094).
 */
export function SaleDeleteDialog({
  saleId,
  docNo,
  onClose,
  onDeleted,
}: {
  saleId: string;
  docNo: string;
  onClose: () => void;
  onDeleted: (targetId: string | null) => void;
}) {
  const [impact, setImpact] = useState<SaleDeleteImpact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payment, setPayment] = useState<"move" | "void">("move");
  const [invoiceChoice, setInvoiceChoice] = useState<"keep" | "move" | null>(null);
  const [targetId, setTargetId] = useState("");
  const [excessOk, setExcessOk] = useState(false);
  const [nts, setNts] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getSaleDeleteImpact(saleId)
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          setImpact(r.impact);
          if (r.impact.candidates.length === 0) setPayment("void");
        } else {
          setLoadError(r.error);
        }
      })
      .catch((e) => {
        if (alive) setLoadError(actionError(e));
      });
    return () => {
      alive = false;
    };
  }, [saleId]);

  const hasDeposits = (impact?.deposits.length ?? 0) > 0;
  const invoice = impact?.invoice ?? null;
  const external = impact?.externalIssued ?? false;
  // 골라야 하는 계산서 — 발행(중)된 기록 또는 시스템 밖 발행 표시
  const invoiceNeedsChoice = (invoice?.needsChoice ?? false) || external;
  const paymentMoves = hasDeposits && payment === "move";
  const invoiceMoves = invoiceNeedsChoice && invoiceChoice === "move";
  const targetRequired = paymentMoves || invoiceMoves;
  const target = impact?.candidates.find((c) => c.id === targetId) ?? null;
  const sameCandidates = impact?.candidates.filter((c) => c.same_partner) ?? [];
  const otherCandidates = impact?.candidates.filter((c) => !c.same_partner) ?? [];

  // 대상 매출 검사 — RPC 도 같은 조건으로 거부한다(여기선 미리 알려 주기만).
  const targetSettledBlock = paymentMoves && target?.status === "settled";
  const invoiceAmounts = invoice
    ? { supply: invoice.supply_krw, vat: invoice.vat_krw, total: invoice.total_krw }
    : impact
      ? { supply: impact.sale.subtotal_krw, vat: impact.sale.vat_krw, total: impact.sale.total_krw }
      : null;
  let invoiceMoveBlock: string | null = null;
  if (invoiceMoves && target && invoiceAmounts && impact) {
    if (target.partner_id !== impact.sale.partner_id) invoiceMoveBlock = "거래처가 다른 매출로는 계산서를 옮길 수 없습니다.";
    else if (!target.is_documented) invoiceMoveBlock = "무자료 매출로는 계산서를 옮길 수 없습니다.";
    else if (target.has_invoice) invoiceMoveBlock = "대상 매출에 이미 계산서가 있습니다(발행 기록 또는 발행 완료 표시).";
    else if (target.subtotal_krw !== invoiceAmounts.supply || target.vat_krw !== invoiceAmounts.vat)
      invoiceMoveBlock = `금액이 다릅니다(대상 ${fmtKrw(target.total_krw)} · 계산서 ${fmtKrw(invoiceAmounts.total)}) — 금액이 바뀌었으면 수정세금계산서가 필요하니 '국세청 기록으로 남기기'를 고르세요.`;
  }
  const receivedAfter = target && impact ? target.received_krw + (paymentMoves ? impact.depositSum : 0) : 0;
  const excess = paymentMoves && target && !targetSettledBlock ? Math.max(receivedAfter - target.total_krw, 0) : 0;
  const ntsKey = nts.replace(/[^0-9A-Za-z]/g, "").toLowerCase();
  const ntsInvalid = external && invoiceChoice === "keep" && ntsKey !== "" && !/^[0-9a-z]{24}$/.test(ntsKey);
  const otherPartner = !!target && !target.same_partner;
  const otherMonth = !!target && !!impact && target.ordered_on.slice(0, 7) !== impact.sale.ordered_on.slice(0, 7);

  const canSubmit =
    !!impact &&
    impact.canDelete &&
    !pending &&
    (!invoiceNeedsChoice || invoiceChoice !== null) &&
    (!targetRequired || !!target) &&
    !targetSettledBlock &&
    !invoiceMoveBlock &&
    !ntsInvalid &&
    (excess === 0 || excessOk);

  function submit() {
    if (!impact) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await deleteSaleWithOptions({
          saleId,
          payment: hasDeposits ? payment : null,
          targetSaleId: targetId || null,
          invoice: invoiceNeedsChoice ? invoiceChoice : null,
          reason,
          nts: external && invoiceChoice === "keep" ? nts : "",
        });
        if (r.ok) {
          toast.success(r.message);
          onDeleted(r.targetId);
        } else {
          setError(r.error);
        }
      } catch (e) {
        setError(actionError(e));
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>매출 삭제</DialogTitle>
          <DialogDescription>
            {impact ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <BookBadge book={impact.sale.book} />
                <span className="font-mono">[{impact.sale.doc_no}]</span>
                {impact.sale.partner_name} · {impact.sale.ordered_on} · {fmtKrw(impact.sale.total_krw)} ·{" "}
                {STATUS_KO[impact.sale.status] ?? impact.sale.status}
              </span>
            ) : (
              <span className="font-mono">[{docNo}]</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : !impact ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> 연결된 수금·계산서를 확인하는 중…
          </p>
        ) : !impact.canDelete ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            매출 삭제는 이 책의 관리자(manager) 이상만 할 수 있습니다.
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-4 text-sm">
            <p className="text-muted-foreground">
              삭제하면 매출 목록·미수·합계에서 빠지고 되돌릴 수 없습니다. 합치거나 새로 만든 매출이 있으면 아래에서 고르세요 —
              수금·계산서를 그쪽으로 옮기고 두 매출 메모에 연결 기록을 남깁니다.
            </p>

            {/* 대상 매출 — 옮길 때는 필수, 아니면 연결 기록용(선택) */}
            <section className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">
                  합치거나 새로 만든 매출 {targetRequired ? "*" : "(선택)"}
                </span>
                <select
                  value={targetId}
                  onChange={(e) => {
                    setTargetId(e.target.value);
                    setExcessOk(false);
                  }}
                  disabled={impact.candidates.length === 0}
                  className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">{impact.candidates.length === 0 ? "— 같은 책에 다른 매출이 없습니다 —" : "— 고르지 않음 —"}</option>
                  {sameCandidates.length > 0 ? (
                    <optgroup label={`같은 거래처 (${impact.sale.partner_name})`}>
                      {sameCandidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {candidateLabel(c)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {otherCandidates.length > 0 ? (
                    <optgroup label="다른 거래처">
                      {otherCandidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {candidateLabel(c)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              {otherPartner ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  다른 거래처({target!.partner_name})의 매출입니다 — 거래처를 바로잡아 다시 만든 경우가 아니면 확인하세요.
                </p>
              ) : null}
              {otherMonth ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  주문월이 다릅니다({impact.sale.ordered_on.slice(0, 7)} → {target!.ordered_on.slice(0, 7)}) — 월합계 계산서는 같은 달
                  공급분만 묶을 수 있고, 매출 집계 달도 바뀝니다.
                </p>
              ) : null}
              {impact.sale.source_quote_doc_no ? (
                <p className="text-xs text-muted-foreground">
                  견적 {impact.sale.source_quote_doc_no}에서 전환된 매출 —{" "}
                  {target ? "대상 매출에 견적 출처가 없으면 넘깁니다." : "대상 없이 지우면 견적을 '발송'으로 되돌려 다시 전환할 수 있게 합니다."}
                </p>
              ) : null}
            </section>

            {/* 수금 기록 */}
            {hasDeposits ? (
              <section className="flex flex-col gap-2 rounded-md border p-3">
                <div className="font-medium">
                  수금 기록 {impact.deposits.length}건 · {fmtKrw(impact.depositSum)}
                </div>
                <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {impact.deposits.map((d) => (
                    <li key={d.id} className="flex justify-between gap-2">
                      <span>
                        <span className="font-mono">{d.txn_on}</span> · {d.account}
                      </span>
                      <span className="tabular-nums">{fmtKrw(d.amount_krw)}</span>
                    </li>
                  ))}
                </ul>
                <label className={`flex items-start gap-2 ${impact.candidates.length === 0 ? "opacity-50" : ""}`}>
                  <input
                    type="radio"
                    name="sale-delete-payment"
                    className="mt-0.5"
                    checked={payment === "move"}
                    disabled={impact.candidates.length === 0}
                    onChange={() => setPayment("move")}
                  />
                  <span>
                    대상 매출로 옮기기 <span className="text-muted-foreground">— 합치거나 새로 만든 매출이 이 돈을 받은 것으로</span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="sale-delete-payment"
                    className="mt-0.5"
                    checked={payment === "void"}
                    onChange={() => setPayment("void")}
                  />
                  <span>
                    수금 기록 지우기{" "}
                    <span className="text-muted-foreground">
                      — 실제로 입금이 없었거나, 돌려줬거나, 이미 다른 매출의 수금에 들어간 돈인 경우
                    </span>
                  </span>
                </label>
                {paymentMoves && target ? (
                  targetSettledBlock ? (
                    <p className="text-xs text-destructive">
                      대상 매출은 이미 수금완료라 옮기면 같은 돈이 두 번 잡힙니다 — 그 수금에 이 돈이 들어 있으면 &lsquo;수금 기록
                      지우기&rsquo;를 고르세요.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      옮긴 뒤 {target.doc_no}: 입금 {fmtKrw(receivedAfter)} / 합계 {fmtKrw(target.total_krw)}
                      {receivedAfter >= target.total_krw ? (
                        target.status === "delivered" || target.status === "overdue" ? (
                          <span className="text-emerald-700 dark:text-emerald-400"> — 수금완료로 바뀝니다</span>
                        ) : (
                          <span> — 납품완료 처리하면 바로 수금완료됩니다</span>
                        )
                      ) : (
                        <span> — 남은 미수 {fmtKrw(target.total_krw - receivedAfter)}(수금 버튼은 남은 금액만 입금으로 기록)</span>
                      )}
                    </p>
                  )
                ) : null}
                {excess > 0 ? (
                  <label className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                    <input type="checkbox" className="mt-0.5" checked={excessOk} onChange={(e) => setExcessOk(e.target.checked)} />
                    <span>
                      입금이 대상 합계보다 {fmtKrw(excess)} 많습니다 — 돌려주거나 다음 거래에서 빼야 하는 돈입니다. 확인했으면 체크하세요.
                    </span>
                  </label>
                ) : null}
              </section>
            ) : null}

            {/* 발행된 세금계산서(또는 시스템 밖 발행 표시) */}
            {invoiceNeedsChoice ? (
              <section className="flex flex-col gap-2 rounded-md border p-3">
                <div className="font-medium">발행된 세금계산서 *</div>
                <div className="text-xs text-muted-foreground">
                  {invoice ? (
                    <>
                      {PROVIDER_KO[invoice.provider] ?? invoice.provider} · {TAX_INVOICE_STATE_KO[invoice.state] ?? invoice.state} · 작성일{" "}
                      <span className="font-mono">{invoice.write_date}</span> · {fmtKrw(invoice.total_krw)}
                      {invoice.nts_confirm_num ? (
                        <>
                          {" "}· 승인번호 <span className="font-mono">{invoice.nts_confirm_num}</span>
                        </>
                      ) : (
                        <> · 승인번호 아직 없음</>
                      )}
                    </>
                  ) : (
                    <>
                      시스템 밖에서 발행해 &lsquo;계산서 발행 완료&rsquo;({impact.sale.tax_invoice_issued_on})로만 표시된 매출입니다 ·{" "}
                      {fmtKrw(impact.sale.total_krw)}
                    </>
                  )}
                </div>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="sale-delete-invoice"
                    className="mt-0.5"
                    checked={invoiceChoice === "keep"}
                    onChange={() => setInvoiceChoice("keep")}
                  />
                  <span>
                    국세청 기록으로 남기고 매출만 삭제{" "}
                    <span className="text-muted-foreground">
                      — 수정세금계산서(−)·발행취소는 팝빌·홈택스에서 직접. 세금계산서 화면 &lsquo;정리 필요&rsquo;에 남습니다.
                    </span>
                  </span>
                </label>
                {external && invoiceChoice === "keep" ? (
                  <div className="ml-6 flex flex-col gap-1">
                    <Input
                      value={nts}
                      maxLength={40}
                      onChange={(e) => setNts(e.target.value)}
                      placeholder="국세청 승인번호 24자리(알면) — 모르면 정리 완료 때 넣어도 됩니다"
                    />
                    {ntsInvalid ? (
                      <span className="text-xs text-destructive">승인번호는 영문·숫자 24자리입니다(하이픈은 빼도 됩니다).</span>
                    ) : null}
                  </div>
                ) : null}
                <label className={`flex items-start gap-2 ${impact.candidates.length === 0 ? "opacity-50" : ""}`}>
                  <input
                    type="radio"
                    name="sale-delete-invoice"
                    className="mt-0.5"
                    checked={invoiceChoice === "move"}
                    disabled={impact.candidates.length === 0}
                    onChange={() => setInvoiceChoice("move")}
                  />
                  <span>
                    대상 매출로 계산서 옮기기{" "}
                    <span className="text-muted-foreground">— 거래처·공급가·세액이 같을 때(내용만 바뀐 경우)</span>
                  </span>
                </label>
                {invoiceMoveBlock ? <p className="text-xs text-destructive">{invoiceMoveBlock}</p> : null}
                {invoice && invoice.provider === "popbill" ? (
                  <p className="text-xs text-muted-foreground">
                    아직 국세청에 전송되기 전이면 매출 상세 › 계산서 › 발행취소를 먼저 할 수 있습니다.
                  </p>
                ) : null}
              </section>
            ) : null}

            {/* 그 밖에 같이 처리되는 것 */}
            {invoice && !invoice.needsChoice ? (
              <p className="text-xs text-muted-foreground">
                {TAX_INVOICE_STATE_KO[invoice.state] ?? invoice.state} 상태의 계산서 기록은 발행 전이라 함께 정리됩니다.
              </p>
            ) : null}
            {impact.hometaxCount > 0 && !invoiceMoves ? (
              <p className="text-xs text-muted-foreground">
                홈택스 수집본 {impact.hometaxCount}건이 이 매출과 연결돼 있습니다 — 홈택스 대사에서 &lsquo;무시(매출 삭제)&rsquo;로 바뀝니다.
              </p>
            ) : null}
            {impact.allocationCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                재고 출고 기록 {impact.allocationCount}건이 풀려 재고로 돌아갑니다.
              </p>
            ) : null}

            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">사유 (선택)</span>
              <Input
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder="예: 10월분 합쳐서 계산서 발행 / 품목이 바뀌어 새로 등록"
              />
            </label>
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            닫기
          </Button>
          {impact?.canDelete ? (
            <Button variant="destructive" onClick={submit} disabled={!canSubmit}>
              {pending ? "삭제 중…" : "삭제"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
