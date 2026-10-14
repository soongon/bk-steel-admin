"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PurchaseQuoteDialog,
  type PurchaseQuoteSources,
  type EditingPurchaseQuote,
} from "@/components/admin/purchase-quote-dialog";
import { type Book } from "@/lib/book";

/** 매입견적 상세 '수정' — 다이얼로그 편집 모드(updatePurchaseQuote) 후 router.refresh. */
export function PurchaseQuoteEditButton({
  book,
  sources,
  editing,
}: {
  book: Book;
  sources: PurchaseQuoteSources;
  editing: EditingPurchaseQuote;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PencilIcon className="size-4" /> 수정
      </Button>
      <PurchaseQuoteDialog
        open={open}
        onOpenChange={setOpen}
        sources={sources}
        book={book}
        editing={editing}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
