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
import { getSaleReceived, settleSale, type SaleReceived } from "./actions";

export type BankAccount = {
  id: string;
  code: string;
  bank_name: string;
  book: string;
  kind: string;
};

/** 수금완료 다이얼로그 — 입금 통장(매출 책과 동일)·수금일 선택 → 통장 입금 기록까지 한 번에. 목록·상세 공용. */
export function SettleDialog({
  sale,
  bankAccounts,
  onClose,
}: {
  sale: { id: string; doc_no: string; book: Book; total_krw: number };
  bankAccounts: BankAccount[];
  onClose: () => void;
}) {
  const accounts = bankAccounts.filter((a) => a.book === sale.book);
  const [bankId, setBankId] = useState(accounts[0]?.id ?? "");
  const [settledOn, setSettledOn] = useState(kstToday());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 이미 받은 입금(지운 매출에서 옮겨 온 수금) — 있으면 남은 금액만 입금으로 기록된다(0094).
  const [paid, setPaid] = useState<SaleReceived | null>(null);

  useEffect(() => {
    let alive = true;
    getSaleReceived(sale.id)
      .then((v) => {
        if (alive) setPaid(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sale.id]);
  const received = paid?.received ?? 0;
  const remaining = Math.max(sale.total_krw - received, 0);
  // 이미 다 받음 — 새 입금 없이 마지막 입금의 날짜·통장으로 수금완료(통장·날짜 입력 불필요).
  const covered = received > 0 && remaining === 0;

  function submit() {
    setError(null);
    const accountId = covered ? (paid?.lastAccountId ?? bankId) : bankId;
    if (!accountId) {
      setError("수금 통장을 선택해주세요.");
      return;
    }
    startTransition(async () => {
      const r = await settleSale(sale.id, accountId, covered ? (paid?.lastTxnOn ?? settledOn) : settledOn);
      if (r.ok) {
        toast.success(covered ? "수금완료 — 이미 받은 입금으로 처리됨" : "수금완료 — 통장 입금 기록됨");
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
          <DialogTitle>수금완료 처리</DialogTitle>
          <DialogDescription>
            [{sale.doc_no}] {fmtKrw(sale.total_krw)} — 입금 통장과 수금일을 확인하세요.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {received > 0 ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              이미 받은 입금 {fmtKrw(received)}(삭제한 매출에서 옮겨 온 수금 등)이 있어{" "}
              {covered
                ? `추가 입금 없이 마지막 입금(${paid?.lastTxnOn ?? "—"})으로 수금완료 처리합니다.`
                : `남은 ${fmtKrw(remaining)}만 입금으로 기록합니다.`}
              {received > sale.total_krw ? (
                <span className="block font-medium text-destructive">
                  입금이 합계보다 {fmtKrw(received - sale.total_krw)} 많습니다 — 돌려주거나 다음 거래에서 빼야 하는 돈입니다.
                </span>
              ) : null}
            </p>
          ) : null}
          {covered ? null : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  수금 통장 * <BookBadge book={sale.book} />
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
                <span className="text-muted-foreground">수금일 *</span>
                <Input type="date" value={settledOn} onChange={(e) => setSettledOn(e.target.value)} />
              </label>
            </>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={submit} disabled={pending || (!covered && !bankId)}>
            {pending ? "처리 중..." : "수금완료"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
