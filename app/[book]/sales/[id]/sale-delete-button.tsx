"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SaleDeleteDialog } from "../sale-delete-dialog";

/** 매출 상세 '삭제' — 수금 기록·계산서 처리 방법을 고르는 삭제 다이얼로그. 지우면 목록으로 돌아간다. */
export function SaleDeleteButton({ saleId, docNo, listHref }: { saleId: string; docNo: string; listHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="text-destructive">
        <Trash2Icon className="size-4" /> 삭제
      </Button>
      {open ? (
        <SaleDeleteDialog
          saleId={saleId}
          docNo={docNo}
          onClose={() => setOpen(false)}
          onDeleted={() => {
            setOpen(false);
            // replace — 뒤로 가기로 지운 매출(404)로 돌아가지 않게.
            router.replace(listHref);
          }}
        />
      ) : null}
    </>
  );
}
