"use client";

import { useState, useTransition } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
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
import { closeDeletedSaleInvoice, refreshDeletedSaleInvoice } from "./actions";

function actionError(e: unknown): string {
  return unstable_isUnrecognizedActionError(e)
    ? "새 버전이 배포됐습니다 — 새로고침한 뒤 다시 해 주세요."
    : "요청이 실패했습니다 — 연결을 확인하고 다시 해 주세요.";
}

/**
 * 지운 매출에 남은 계산서 정리 — 국세청에서 수정세금계산서(−)를 발행했거나 발행취소했으면 표시한다.
 * 수정세금계산서: 원본은 국세청에 남으니 합계 유지 · 발행취소: 합계에서 빠짐.
 */
export function CloseOrphanInvoiceButton({
  invoiceId,
  label,
  hasNts,
}: {
  invoiceId: string;
  label: string;
  /** 기록에 국세청 승인번호가 있음 — 없으면 '수정세금계산서 발행함'으로 정리할 때 원 승인번호를 받는다. */
  hasNts: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<"modified" | "cancelled" | null>(null);
  const [note, setNote] = useState("");
  const [nts, setNts] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ntsKey = nts.replace(/[^0-9A-Za-z]/g, "").toLowerCase();
  const ntsInvalid = ntsKey !== "" && !/^[0-9a-z]{24}$/.test(ntsKey);
  const ntsRequired = !hasNts && resolution === "modified";

  function submit() {
    if (!resolution) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await closeDeletedSaleInvoice(invoiceId, resolution, note, hasNts ? "" : nts);
        if (r.ok) {
          toast.success(
            resolution === "cancelled" ? "발행취소로 정리했습니다 — 합계에서 빠집니다" : "수정세금계산서 발행으로 정리했습니다",
          );
          setOpen(false);
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
            <DialogTitle>계산서 정리 완료</DialogTitle>
            <DialogDescription>{label} — 국세청에서 어떻게 정리했는지 고르세요.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="orphan-resolution"
                className="mt-0.5"
                checked={resolution === "modified"}
                onChange={() => setResolution("modified")}
              />
              <span>
                수정세금계산서(−) 발행함{" "}
                <span className="text-muted-foreground">— 원본은 국세청에 남으므로 이 달 합계에 그대로 둡니다</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="orphan-resolution"
                className="mt-0.5"
                checked={resolution === "cancelled"}
                onChange={() => setResolution("cancelled")}
              />
              <span>
                발행취소됨 <span className="text-muted-foreground">— 국세청 전송 전에 취소돼 계산서가 없음, 합계에서 뺍니다</span>
              </span>
            </label>
            {!hasNts ? (
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">
                  원 계산서 국세청 승인번호 {ntsRequired ? "*" : "(선택)"}
                </span>
                <Input
                  value={nts}
                  maxLength={40}
                  onChange={(e) => setNts(e.target.value)}
                  placeholder="24자리 — 홈택스 대사가 이 번호로 알아보고 매출을 되살리지 않습니다"
                />
                {ntsInvalid ? <span className="text-xs text-destructive">승인번호는 영문·숫자 24자리입니다(하이픈은 빼도 됩니다).</span> : null}
              </label>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">메모 (선택)</span>
              <Input
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 10/30 홈택스에서 수정세금계산서(−) 발행, 승인번호 …"
              />
            </label>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              닫기
            </Button>
            <Button onClick={submit} disabled={pending || !resolution || ntsInvalid || (ntsRequired && ntsKey === "")}>
              {pending ? "처리 중…" : "정리 완료로 표시"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 지운 매출에 남은 팝빌 계산서의 승인번호를 다시 받아 온다(발행 직후 지워 번호가 비어 있을 때 — 홈택스 대사가 번호로 알아본다). */
export function RefreshOrphanInvoiceButton({ saleId }: { saleId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const r = await refreshDeletedSaleInvoice(saleId);
            if (r.ok) toast.success(r.nts ? `승인번호를 받았습니다 — ${r.nts}` : "아직 승인번호가 없습니다 — 잠시 후 다시 조회하세요");
            else toast.error(r.error);
          } catch (e) {
            toast.error(actionError(e));
          }
        })
      }
    >
      {pending ? "조회 중…" : "상태 조회"}
    </Button>
  );
}
