"use client";

import { useState, useTransition } from "react";
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
import { fmtKrw } from "@/lib/format";
import { settleSale } from "./actions";

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
  const [settledOn, setSettledOn] = useState(new Date().toISOString().slice(0, 10));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!bankId) {
      setError("수금 통장을 선택해주세요.");
      return;
    }
    startTransition(async () => {
      const r = await settleSale(sale.id, bankId, settledOn);
      if (r.ok) {
        toast.success("수금완료 — 통장 입금 기록됨");
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={submit} disabled={pending || !bankId}>
            {pending ? "처리 중..." : "수금완료"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
