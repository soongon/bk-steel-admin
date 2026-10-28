"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PurchaseDeleteDialog } from "../purchase-delete-dialog";

/** 매입 상세 '삭제' — 결제 기록·공급자 계산서 처리 방법을 고르는 삭제 다이얼로그. 지우면 목록으로 돌아간다. */
export function PurchaseDeleteButton({ purchaseId, docNo, listHref }: { purchaseId: string; docNo: string; listHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="text-destructive">
        <Trash2Icon className="size-4" /> 삭제
      </Button>
      {open ? (
        <PurchaseDeleteDialog
          purchaseId={purchaseId}
          docNo={docNo}
          onClose={() => setOpen(false)}
          onDeleted={() => {
            setOpen(false);
            // replace — 뒤로 가기로 지운 매입(404)으로 돌아가지 않게.
            router.replace(listHref);
          }}
        />
      ) : null}
    </>
  );
}
