"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuoteDialog, type QuoteSources, type EditingQuote } from "@/components/admin/quote-dialog";
import { type Book } from "@/lib/book";

/**
 * 견적 상세 '수정' — QuoteDialog 편집 모드를 열어 거래처·현장·유효기간·품목·조건을 수정(updateQuote).
 * 저장 후 router.refresh 로 상세 갱신.
 */
export function QuoteEditButton({
  book,
  sources,
  editing,
}: {
  book: Book;
  sources: QuoteSources;
  editing: EditingQuote;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PencilIcon className="size-4" /> 수정
      </Button>
      <QuoteDialog
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
