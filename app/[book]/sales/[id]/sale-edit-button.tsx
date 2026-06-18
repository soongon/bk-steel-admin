"use client";

import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type BookView } from "@/lib/book";
import { type CompanyProfile } from "@/lib/company-profile";
import {
  SaleFormDialog,
  type SaleRow,
  type Partner,
  type Item,
  type RebarSpec,
  type SiteOption,
} from "../sale-form-dialog";

/**
 * 매출 상세 '수정' — 목록에서 옮겨온 헤더 편집 진입점. SaleFormDialog(편집 모드)를 열어
 * 일자·상태·자료·거래처·현장·비고를 수정(updateSaleHeader). 신규 등록은 목록에 그대로.
 */
export function SaleEditButton({
  sale,
  view,
  partners,
  items,
  rebarSpecs,
  sites,
  companies,
}: {
  sale: SaleRow;
  view: BookView;
  partners: Partner[];
  items: Item[];
  rebarSpecs: RebarSpec[];
  sites: SiteOption[];
  companies: CompanyProfile[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PencilIcon className="size-4" /> 수정
      </Button>
      <SaleFormDialog
        open={open}
        onOpenChange={setOpen}
        editing={sale}
        view={view}
        partners={partners}
        items={items}
        rebarSpecs={rebarSpecs}
        sites={sites}
        companies={companies}
      />
    </>
  );
}
