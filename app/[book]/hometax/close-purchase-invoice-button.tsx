"use client";

import { useState, useTransition } from "react";
import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
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
import { closeDeletedPurchaseInvoice } from "./actions";

function actionError(e: unknown): string {
  return unstable_isUnrecognizedActionError(e)
    ? "새 버전이 배포됐습니다 — 새로고침한 뒤 다시 해 주세요."
    : "요청이 실패했습니다 — 연결을 확인하고 다시 해 주세요.";
}

/**
 * 지운 매입에 남은 공급자 계산서(수집본) 정리 — 공급자 수정세금계산서(−)를 받았거나 대체 매입에 반영했으면 표시한다.
 * 수집본은 국세청 기록 그대로 남고(합계 유지) '정리 필요'에서만 빠진다.
 */
export function ClosePurchaseInvoiceButton({ hometaxInvoiceId, label }: { hometaxInvoiceId: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await closeDeletedPurchaseInvoice(hometaxInvoiceId, note);
        if (r.ok) {
          toast.success("정리 완료로 표시했습니다");
          setOpen(false);
          router.refresh();
        } else {
          setError(r.error);
        }
      } catch (e) {
        setError(actionError(e));
      }
    });
  }

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        정리 완료
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!pending) setOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>매입 계산서 정리 완료</DialogTitle>
            <DialogDescription>
              {label} — 공급자에게 수정세금계산서(−)를 받았거나, 다른 매입에 반영했으면 정리 완료로 표시합니다. 수집본은 국세청 기록
              그대로 남습니다.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">메모 (선택)</span>
            <Input
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 수정세금계산서(−) 10/31 수취 / 대체 매입에 반영"
            />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              닫기
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "처리 중…" : "정리 완료"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
