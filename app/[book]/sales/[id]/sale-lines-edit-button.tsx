"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageIcon, XIcon } from "lucide-react";
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
import {
  type LineDraft,
  type DraftItem,
  type DraftRebarSpec,
  calcLineDraft,
  serializeLines,
} from "@/lib/transaction-draft";
import { fmtKrw, fmtNum } from "@/lib/format";
import { updateSaleLines } from "../actions";

/**
 * 매출 상세 '품목 수정' — 기존 라인의 수량·단가만 수정(품목 종류는 고정), 라인 삭제 가능.
 * 합계·부가세는 저장 시 서버에서 재계산(updateSaleLines → update_sale_with_lines).
 * 매출 편집 폼은 건드리지 않아 회귀 위험이 낮다.
 */
export function SaleLinesEditButton({
  saleId,
  initialLines,
  items,
  rebarSpecs,
}: {
  saleId: string;
  initialLines: LineDraft[];
  items: DraftItem[];
  rebarSpecs: DraftRebarSpec[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>(initialLines);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const setQty = (i: number, v: string) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, qty: Number(v) || 0 } : l)));
  const setPrice = (i: number, v: string) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, unitPrice: Number(v) || 0 } : l)));
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const subtotal = lines.reduce((s, l) => s + calcLineDraft(items, rebarSpecs, l).subtotal, 0);

  function onSave() {
    setError(null);
    if (lines.length === 0) {
      setError("품목을 1개 이상 남겨주세요.");
      return;
    }
    for (const l of lines) {
      if (l.qty <= 0 || l.unitPrice <= 0) {
        setError("수량·단가를 확인해주세요.");
        return;
      }
    }
    const fd = new FormData();
    fd.set("sale_id", saleId);
    fd.set("lines", serializeLines(items, rebarSpecs, lines));
    start(async () => {
      const r = await updateSaleLines(fd);
      if (r.ok) {
        toast.success("품목이 수정되었습니다");
        setOpen(false);
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setLines(initialLines);
          setError(null);
          setOpen(true);
        }}
      >
        <PackageIcon className="size-4" /> 품목 수정
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>품목 수정</DialogTitle>
            <DialogDescription>
              수량·단가를 고치면 합계·부가세가 자동 재계산됩니다. 품목 종류는 고정이며, 불필요한 줄은 삭제할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
            {lines.map((l, i) => {
              const { item, calc, subtotal: sub } = calcLineDraft(items, rebarSpecs, l);
              const reb = !!item?.rebar_spec_code && !!calc;
              return (
                <div key={i} className="rounded-lg border p-2">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-medium">{item?.name ?? "—"}</span>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      aria-label="삭제"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-0.5 text-xs">
                      <span className="text-muted-foreground">수량 ({l.unit})</span>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={l.qty || ""}
                        onChange={(e) => setQty(i, e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-xs">
                      <span className="text-muted-foreground">단가{reb ? " (원/kg)" : " (원)"}</span>
                      <Input
                        type="number"
                        step="1"
                        value={l.unitPrice || ""}
                        onChange={(e) => setPrice(i, e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
                    {reb && calc ? `${fmtNum(calc.weightKg)}kg · ` : ""}
                    {fmtKrw(sub)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">공급가</span>
            <span className="font-semibold tabular-nums">{fmtKrw(subtotal)}</span>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button onClick={onSave} disabled={pending}>
              {pending ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
