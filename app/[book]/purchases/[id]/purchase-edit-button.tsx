"use client";

import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type BookView } from "@/lib/book";
import {
  PurchaseFormDialog,
  type PurchaseRow,
  type Partner,
  type Item,
  type RebarSpec,
  type SiteOption,
} from "../purchase-form-dialog";

/**
 * 매입 상세 '수정' — PurchaseFormDialog(편집 모드)를 열어 품목 라인(추가·삭제·실중량, 0093)과
 * 입고일·상태·자료·현장·비고를 수정. 목록의 연필은 헤더만, 여기서는 라인까지(purchase.lines 프리필).
 */
export function PurchaseEditButton({
  purchase,
  view,
  partners,
  items,
  rebarSpecs,
  sites,
}: {
  purchase: PurchaseRow;
  view: BookView;
  partners: Partner[];
  items: Item[];
  rebarSpecs: RebarSpec[];
  sites: SiteOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PencilIcon className="size-4" /> 수정
      </Button>
      <PurchaseFormDialog
        open={open}
        onOpenChange={setOpen}
        editing={purchase}
        view={view}
        partners={partners}
        items={items}
        rebarSpecs={rebarSpecs}
        sites={sites}
      />
    </>
  );
}
