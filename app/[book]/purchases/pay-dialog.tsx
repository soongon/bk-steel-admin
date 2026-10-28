"use client";

import { useEffect, useState, useTransition } from "react";
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
import { type Book } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { fmtKrw, kstToday } from "@/lib/format";
import { getPurchasePaid, markPurchasePaid, type PurchasePaid } from "./actions";

export type BankAccount = {
  id: string;
  code: string;
  bank_name: string;
  book: string;
  kind: string;
};

/** 결제완료 다이얼로그 — 출금 통장(매입 책과 동일)·결제일 선택 → 통장 출금 기록까지 한 번에. 목록·상세 공용. */
export function PayDialog({
  purchase,
  bankAccounts,
  onClose,
}: {
  purchase: { id: string; doc_no: string; book: Book; total_krw: number };
  bankAccounts: BankAccount[];
  onClose: () => void;
}) {
  const accounts = bankAccounts.filter((a) => a.book === purchase.book);
  const [bankId, setBankId] = useState(accounts[0]?.id ?? "");
  const [paidOn, setPaidOn] = useState(kstToday());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 이미 나간 출금(지운 매입에서 옮겨 온 결제)과 지금 합계 — 있으면 남은 금액만 출금으로 기록된다(0095).
  // 불러오기 전에는 [결제완료]를 막는다(판단 없이 눌러 다른 통장으로 처리되지 않게). 실패하면 보통 결제로.
  const [prior, setPrior] = useState<PurchasePaid | null>(null);
  const [priorFailed, setPriorFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getPurchasePaid(purchase.id)
      .then((v) => {
        if (alive) setPrior(v);
      })
      .catch(() => {
        if (alive) setPriorFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [purchase.id]);
  const loaded = prior !== null || priorFailed;
  const total = prior?.total ?? purchase.total_krw;
  const paid = prior?.paid ?? 0;
  const remaining = Math.max(total - paid, 0);
  // 이미 다 냄 — 새 출금 없이 마지막 출금의 날짜·통장으로 결제완료(통장·날짜 입력 불필요). 판단은 지금 합계로.
  const covered = paid > 0 && remaining === 0;

  function submit() {
    setError(null);
    if (!covered && !bankId) {
      setError("결제 통장을 선택해주세요.");
      return;
    }
    startTransition(async () => {
      const r = await markPurchasePaid(purchase.id, covered ? "" : bankId, covered ? (prior?.lastTxnOn ?? paidOn) : paidOn, { covered });
      if (r.ok) {
        toast.success(covered ? "결제완료 — 이미 나간 출금으로 처리됨" : "결제완료 — 통장 출금 기록됨");
        onClose();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>결제완료 처리</DialogTitle>
          <DialogDescription>
            [{purchase.doc_no}] {fmtKrw(total)} — 출금 통장과 결제일을 확인하세요.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {paid > 0 ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              이미 나간 출금 {fmtKrw(paid)}(삭제한 매입에서 옮겨 온 결제 등)이 있어{" "}
              {covered
                ? `추가 출금 없이 마지막 출금(${prior?.lastTxnOn ?? "—"})으로 결제완료 처리합니다.`
                : `남은 ${fmtKrw(remaining)}만 출금으로 기록합니다.`}
              {paid > total ? (
                <span className="block font-medium text-destructive">
                  출금이 합계보다 {fmtKrw(paid - total)} 많습니다 — 돌려받거나 다음 거래에서 빼야 하는 돈입니다.
                </span>
              ) : null}
            </p>
          ) : null}
          {covered ? null : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  출금 통장 * <BookBadge book={purchase.book} />
                </span>
                <select
                  value={bankId}
                  onChange={(e) => setBankId(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— 선택 —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.bank_name}
                    </option>
                  ))}
                </select>
                {accounts.length === 0 ? (
                  <span className="text-xs text-amber-600">
                    이 책의 활성 통장이 없습니다 — 통장 페이지에서 먼저 등록하세요
                  </span>
                ) : null}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">결제일 *</span>
                <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </label>
            </>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={submit} disabled={pending || !loaded || (!covered && !bankId)}>
            {pending ? "처리 중..." : "결제완료"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
