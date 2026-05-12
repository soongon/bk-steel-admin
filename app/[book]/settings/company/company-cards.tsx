"use client";

import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Book, BOOK_LABEL, BOOKS } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { type CompanyProfile } from "@/lib/company-profile";
import { CompanyFormDialog } from "./company-form-dialog";

export function CompanyCards({ profiles }: { profiles: CompanyProfile[] }) {
  const byBook = new Map(profiles.map((p) => [p.book, p]));
  const [editing, setEditing] = useState<Book | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {BOOKS.map((book) => {
          const p = byBook.get(book);
          return (
            <div
              key={book}
              className="rounded-xl border bg-card p-4 ring-1 ring-foreground/10"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookBadge book={book} size="md" />
                  <span className="text-xs text-muted-foreground">
                    {BOOK_LABEL[book]} 책
                  </span>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditing(book)}>
                  <PencilIcon className="size-4" />
                  편집
                </Button>
              </div>

              {p ? (
                <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                  <Row label="상호" value={p.name} bold />
                  <Row label="사업자번호" value={p.business_no} mono />
                  <Row label="대표자" value={p.representative} />
                  <Row label="업태/종목" value={joinSlash(p.business_type, p.business_item)} />
                  <Row label="주소" value={p.address} colSpan />
                  <Row label="전화" value={p.phone} />
                  <Row label="팩스" value={p.fax} />
                  <Row label="휴대폰" value={p.mobile} />
                  <Row label="이메일" value={p.email} />
                  {p.bank_default_name ? (
                    <Row
                      label="기본 입금"
                      value={`${p.bank_default_name}${p.bank_default_no ? ` · ${p.bank_default_no}` : ""}`}
                      colSpan
                    />
                  ) : null}
                  {p.notes ? <Row label="비고" value={p.notes} colSpan /> : null}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  미설정 — 편집 버튼으로 등록
                </p>
              )}
            </div>
          );
        })}
      </div>

      <CompanyFormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        book={editing ?? "bk"}
        profile={editing ? byBook.get(editing) ?? null : null}
      />
    </>
  );
}

function Row({
  label,
  value,
  bold,
  mono,
  colSpan,
}: {
  label: string;
  value: string | null | undefined;
  bold?: boolean;
  mono?: boolean;
  colSpan?: boolean;
}) {
  return (
    <>
      <dt className={`col-span-1 text-muted-foreground ${colSpan ? "" : ""}`}>{label}</dt>
      <dd
        className={`${colSpan ? "col-span-2" : "col-span-2"} ${bold ? "font-semibold" : ""} ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value || <span className="text-muted-foreground">—</span>}
      </dd>
    </>
  );
}

function joinSlash(a: string | null, b: string | null): string | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return `${a} / ${b}`;
}
