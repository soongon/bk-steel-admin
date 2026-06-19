"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { TruckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markSaleDelivered } from "../actions";

/**
 * 매출 상세 상단 '납품완료' — 미납품(주문/확정) 상태에서만 노출. 상태머신(markSaleDelivered)으로
 * 납품 완료 처리. 라이프사이클 패널 납품 단계 버튼과 동일 동작(상단에 더 눈에 띄게 제공).
 */
export function SaleDeliverButton({ saleId, docNo }: { saleId: string; docNo: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onDeliver() {
    if (!window.confirm(`[${docNo}] 납품완료로 처리하시겠습니까?`)) return;
    start(async () => {
      const r = await markSaleDelivered(saleId);
      if (r.ok) {
        toast.success("납품완료 처리됨");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Button size="sm" onClick={onDeliver} disabled={pending}>
      <TruckIcon className="size-4" /> 납품완료
    </Button>
  );
}
