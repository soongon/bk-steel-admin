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
import {
  deletePurchaseWithOptions,
  getPurchaseDeleteImpact,
  type PurchaseDeleteCandidate,
  type PurchaseDeleteImpact,
} from "./delete-actions";

const STATUS_KO: Record<string, string> = {
  ordered: "발주",
  in_stock: "입고완료",
  partial_out: "일부 출고",
  depleted: "전량 출고",
  transferred_out: "이관",
  scrapped: "폐기",
};

function actionError(e: unknown): string {
  return unstable_isUnrecognizedActionError(e)
    ? "새 버전이 배포됐습니다 — 새로고침한 뒤 다시 해 주세요."
    : "요청이 실패했습니다 — 연결을 확인하고 다시 해 주세요.";
}

function candidateLabel(c: PurchaseDeleteCandidate): string {
  return [
    c.doc_no,
    c.ordered_on,
    c.same_partner ? null : c.partner_name,
    fmtKrw(c.total_krw),
    c.paid_on ? "결제완료" : c.paid_krw > 0 ? `출금 ${fmtKrw(c.paid_krw)}` : "미결제",
    c.has_invoice ? "계산서 있음" : null,
    c.from_hometax ? "홈택스 생성" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 매입 삭제 — 지우기 전에 딸린 것(출금 기록·공급자 계산서·재고 lot)을 보여 주고 처리 방법을 고르게 한다.
 * 합치기·다시 만들기는 대상 매입(합친·새로 만든 매입)을 골라 결제·계산서를 옮기고 연결 기록을 남긴다.
 * 아니면 결제 기록을 지우고, 공급자 계산서는 국세청 기록으로 남긴다(홈택스 화면 '정리 필요').
 * 출고(매출 할당)·가공 이력이 있는 매입은 지울 수 없다. 목록·상세 공용. 실제 처리는 delete_purchase RPC 한 번(0095).
 */
export function PurchaseDeleteDialog({
  purchaseId,
  docNo,
  onClose,
  onDeleted,
}: {
  purchaseId: string;
  docNo: string;
  onClose: () => void;
  onDeleted: (targetId: string | null) => void;
}) {
  const [impact, setImpact] = useState<PurchaseDeleteImpact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payment, setPayment] = useState<"move" | "void">("move");
  const [invoiceChoice, setInvoiceChoice] = useState<"keep" | "move" | null>(null);
  const [targetId, setTargetId] = useState("");
  const [excessOk, setExcessOk] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getPurchaseDeleteImpact(purchaseId)
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
  }, [purchaseId]);

  const hasPayments = (impact?.payments.length ?? 0) > 0;
  const invoice = impact?.invoice ?? null;
  const paymentMoves = hasPayments && payment === "move";
  const invoiceMoves = !!invoice && invoiceChoice === "move";
  const targetRequired = paymentMoves || invoiceMoves;
  const target = impact?.candidates.find((c) => c.id === targetId) ?? null;
  const sameCandidates = impact?.candidates.filter((c) => c.same_partner) ?? [];
  const otherCandidates = impact?.candidates.filter((c) => !c.same_partner) ?? [];
  const blocked = (impact?.blockingSales.length ?? 0) > 0 || !!impact?.blockedReason;

  // 대상 매입 검사 — RPC 도 같은 조건으로 거부한다(여기선 미리 알려 주기만).
  const targetPaidBlock = paymentMoves && !!target?.paid_on;
  let invoiceMoveBlock: string | null = null;
  if (invoiceMoves && target && invoice && impact) {
    if (target.partner_id !== impact.purchase.partner_id) invoiceMoveBlock = "매입처가 다른 매입으로는 계산서를 옮길 수 없습니다.";
    else if (!target.is_documented) invoiceMoveBlock = "무자료 매입으로는 계산서를 옮길 수 없습니다.";
    else if (target.has_invoice) invoiceMoveBlock = "대상 매입에 이미 계산서가 있습니다(승인번호 또는 홈택스 연결).";
    else if (target.subtotal_krw !== invoice.supply_krw)
      invoiceMoveBlock = `공급가가 다릅니다(대상 ${fmtKrw(target.subtotal_krw)} · 계산서 ${fmtKrw(invoice.supply_krw)}) — 금액이 바뀌었으면 공급자에게 수정세금계산서가 필요하니 '국세청 기록으로 남기기'를 고르세요.`;
    else if (target.vat_krw !== invoice.vat_krw && (Math.abs(target.vat_krw - invoice.vat_krw) > 10 || !!target.paid_on || target.paid_krw > 0))
      invoiceMoveBlock = `세액이 다릅니다(대상 ${fmtKrw(target.vat_krw)} · 계산서 ${fmtKrw(invoice.vat_krw)}).`;
  }
  const vatWillAdjust = invoiceMoves && !!target && !!invoice && !invoiceMoveBlock && target.vat_krw !== invoice.vat_krw;
  const targetTotalAfter = target && vatWillAdjust && invoice ? target.subtotal_krw + invoice.vat_krw : (target?.total_krw ?? 0);
  const paidAfter = target && impact ? target.paid_krw + (paymentMoves ? impact.paymentSum : 0) : 0;
  const excess = paymentMoves && target && !targetPaidBlock ? Math.max(paidAfter - targetTotalAfter, 0) : 0;
  const otherPartner = !!target && !target.same_partner;
  const otherMonth = !!target && !!impact && target.ordered_on.slice(0, 7) !== impact.purchase.ordered_on.slice(0, 7);

  const canSubmit =
    !!impact &&
    impact.canDelete &&
    !blocked &&
    !pending &&
    (!invoice || invoiceChoice !== null) &&
    (!targetRequired || !!target) &&
    !targetPaidBlock &&
    !invoiceMoveBlock &&
    (excess === 0 || excessOk);

  function submit() {
    if (!impact) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await deletePurchaseWithOptions({
          purchaseId,
          payment: hasPayments ? payment : null,
          targetPurchaseId: targetId || null,
          invoice: invoice ? invoiceChoice : null,
          reason,
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
          <DialogTitle>매입 삭제</DialogTitle>
          <DialogDescription>
            {impact ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <BookBadge book={impact.purchase.book} />
                <span className="font-mono">[{impact.purchase.doc_no}]</span>
                {impact.purchase.partner_name} · {impact.purchase.ordered_on} · {fmtKrw(impact.purchase.total_krw)} ·{" "}
                {STATUS_KO[impact.purchase.status] ?? impact.purchase.status}
                {impact.purchase.paid_on ? " · 결제완료" : ""}
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
            <Loader2Icon className="size-4 animate-spin" /> 연결된 결제·계산서를 확인하는 중…
          </p>
        ) : !impact.canDelete ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            매입 삭제는 이 책의 관리자(manager) 이상만 할 수 있습니다.
          </p>
        ) : blocked ? (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            {impact.blockedReason ??
              `이 매입의 재고를 출고해 간 매출이 있어 지울 수 없습니다 — 매출 ${impact.blockingSales.join(", ")} 쪽을 먼저 정리하세요. (지우면 그 매출의 원가가 지운 재고에 묶입니다.)`}
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-4 text-sm">
            <p className="text-muted-foreground">
              삭제하면 매입 목록·미지급·합계에서 빠지고 되돌릴 수 없습니다. 합치거나 새로 만든 매입이 있으면 아래에서 고르세요 —
              결제·계산서를 그쪽으로 옮기고 두 매입 메모에 연결 기록을 남깁니다.
            </p>

            {/* 대상 매입 — 옮길 때는 필수, 아니면 연결 기록용(선택) */}
            <section className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">
                  합치거나 새로 만든 매입 {targetRequired ? "*" : "(선택)"}
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
                  <option value="">{impact.candidates.length === 0 ? "— 같은 책에 다른 매입이 없습니다 —" : "— 고르지 않음 —"}</option>
                  {sameCandidates.length > 0 ? (
                    <optgroup label={`같은 매입처 (${impact.purchase.partner_name})`}>
                      {sameCandidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {candidateLabel(c)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {otherCandidates.length > 0 ? (
                    <optgroup label="다른 매입처">
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
                  다른 매입처({target!.partner_name})의 매입입니다 — 매입처를 바로잡아 다시 만든 경우가 아니면 확인하세요.
                </p>
              ) : null}
              {otherMonth ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  날짜의 달이 다릅니다({impact.purchase.ordered_on.slice(0, 7)} → {target!.ordered_on.slice(0, 7)}) — 매입 집계 달이 바뀝니다.
                </p>
              ) : null}
            </section>

            {/* 결제 기록(출금) */}
            {hasPayments ? (
              <section className="flex flex-col gap-2 rounded-md border p-3">
                <div className="font-medium">
                  결제 기록(출금) {impact.payments.length}건 · {fmtKrw(impact.paymentSum)}
                </div>
                <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {impact.payments.map((d) => (
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
                    name="purchase-delete-payment"
                    className="mt-0.5"
                    checked={payment === "move"}
                    disabled={impact.candidates.length === 0}
                    onChange={() => setPayment("move")}
                  />
                  <span>
                    대상 매입으로 옮기기 <span className="text-muted-foreground">— 합치거나 새로 만든 매입에 이 돈을 낸 것으로</span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="purchase-delete-payment"
                    className="mt-0.5"
                    checked={payment === "void"}
                    onChange={() => setPayment("void")}
                  />
                  <span>
                    결제 기록 지우기{" "}
                    <span className="text-muted-foreground">
                      — 실제로 나가지 않았거나, 돌려받았거나, 이미 다른 매입의 결제에 들어간 돈인 경우
                    </span>
                  </span>
                </label>
                {paymentMoves && target ? (
                  targetPaidBlock ? (
                    <p className="text-xs text-destructive">
                      대상 매입은 이미 결제완료라 옮기면 같은 돈이 두 번 나갑니다 — 그 결제에 이 돈이 들어 있으면 &lsquo;결제 기록
                      지우기&rsquo;를 고르세요.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      옮긴 뒤 {target.doc_no}: 출금 {fmtKrw(paidAfter)} / 합계 {fmtKrw(targetTotalAfter)}
                      {paidAfter >= targetTotalAfter ? (
                        <span className="text-emerald-700 dark:text-emerald-400"> — 결제완료로 바뀝니다</span>
                      ) : (
                        <span> — 남은 미지급 {fmtKrw(targetTotalAfter - paidAfter)}(결제 버튼은 남은 금액만 출금으로 기록)</span>
                      )}
                    </p>
                  )
                ) : null}
                {excess > 0 ? (
                  <label className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                    <input type="checkbox" className="mt-0.5" checked={excessOk} onChange={(e) => setExcessOk(e.target.checked)} />
                    <span>
                      출금이 대상 합계보다 {fmtKrw(excess)} 많습니다 — 돌려받거나 다음 거래에서 빼야 하는 돈입니다. 확인했으면 체크하세요.
                    </span>
                  </label>
                ) : null}
              </section>
            ) : null}

            {/* 공급자 세금계산서 */}
            {invoice ? (
              <section className="flex flex-col gap-2 rounded-md border p-3">
                <div className="font-medium">공급자 세금계산서 *</div>
                <div className="text-xs text-muted-foreground">
                  {invoice.receivedOnly
                    ? `계산서 수취 표시(승인번호 없음${invoice.receivedOn ? ` · 수취일 ${invoice.receivedOn}` : ""})`
                    : invoice.hometaxCount > 1
                      ? `홈택스 수집본 ${invoice.hometaxCount}장 연결(당초·수정·재발행 — 금액은 순합계)`
                      : invoice.hometaxCount > 0
                        ? "홈택스 수집본 연결"
                        : "승인번호 기록"}
                  {invoice.write_date ? (
                    <>
                      {" "}· 작성일 <span className="font-mono">{invoice.write_date}</span>
                    </>
                  ) : null}{" "}
                  · {fmtKrw(invoice.total_krw)}
                  {invoice.nts ? (
                    <>
                      {" "}· 승인번호 <span className="font-mono">{invoice.nts}</span>
                    </>
                  ) : null}
                </div>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="purchase-delete-invoice"
                    className="mt-0.5"
                    checked={invoiceChoice === "keep"}
                    onChange={() => setInvoiceChoice("keep")}
                  />
                  <span>
                    국세청 기록으로 남기고 매입만 삭제{" "}
                    <span className="text-muted-foreground">
                      {invoice.receivedOnly
                        ? "— 공급자에게 수정세금계산서(−)를 받거나 대체 매입에 연결하세요. 다음 홈택스 대사가 그 계산서를 '지운 매입의 계산서'로 잡아 매입을 다시 만들지 않습니다."
                        : "— 공급자에게 수정세금계산서(−)를 받거나 대체 매입에 연결하세요. 홈택스 대사 화면 '정리 필요'에 남습니다."}
                    </span>
                  </span>
                </label>
                <label className={`flex items-start gap-2 ${impact.candidates.length === 0 ? "opacity-50" : ""}`}>
                  <input
                    type="radio"
                    name="purchase-delete-invoice"
                    className="mt-0.5"
                    checked={invoiceChoice === "move"}
                    disabled={impact.candidates.length === 0}
                    onChange={() => setInvoiceChoice("move")}
                  />
                  <span>
                    대상 매입으로 계산서 옮기기{" "}
                    <span className="text-muted-foreground">— 같은 매입처·공급가가 같을 때(내용만 바뀐 경우)</span>
                  </span>
                </label>
                {invoiceMoveBlock ? <p className="text-xs text-destructive">{invoiceMoveBlock}</p> : null}
                {vatWillAdjust && invoice && target ? (
                  <p className="text-xs text-muted-foreground">
                    대상 세액을 계산서 기준({fmtKrw(invoice.vat_krw)})으로 맞춥니다(공급자 끝전 차이 {fmtKrw(Math.abs(target.vat_krw - invoice.vat_krw))}).
                  </p>
                ) : null}
              </section>
            ) : null}

            {/* 재고 lot */}
            {impact.lines.count > 0 ? (
              <p className="text-xs text-muted-foreground">
                품목(재고 lot) {impact.lines.count}줄{impact.lines.summary ? `(${impact.lines.summary})` : ""}
                {impact.lines.weightKg > 0 ? ` · ${impact.lines.weightKg.toLocaleString("ko-KR")}kg` : ""}이 재고에서 빠집니다 — 합친(새)
                매입에 품목이 들어 있는지 확인하세요.
              </p>
            ) : null}

            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">사유 (선택)</span>
              <Input
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder="예: 공급자 월합계 계산서에 맞춰 합침 / 품목이 바뀌어 새로 등록"
              />
            </label>
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            닫기
          </Button>
          {impact?.canDelete && !blocked ? (
            <Button variant="destructive" onClick={submit} disabled={!canSubmit}>
              {pending ? "삭제 중…" : "삭제"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
