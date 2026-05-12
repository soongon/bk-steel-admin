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
          // B 책은 SL의 무자료 흐름 — 명세서는 SL 정보로 발행. 편집은 SL 카드에서만.
          const aliasOfSL = book === "b";
          const effective: Book = aliasOfSL ? "sl" : book;
          const p = byBook.get(effective);
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
                {aliasOfSL ? (
                  <span className="inline-flex h-6 items-center rounded-md border border-dashed px-2 text-xs text-muted-foreground">
                    사업자 정보 사용
                  </span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setEditing(book)}>
                    <PencilIcon className="size-4" />
                    편집
                  </Button>
                )}
              </div>

              {aliasOfSL ? (
                <p className="mb-2 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                  B계좌는 SL 사업자의 무자료 흐름입니다. 거래명세표·세금계산서는 사업자(SL) 정보를 그대로 사용 — 사업자 카드에서만 편집하세요.
                </p>
              ) : null}

              {p ? (
                <>
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
                  {p.stamp_url ? (
                    <div className="mt-3 flex items-center gap-2 border-t pt-3">
                      <span className="text-xs text-muted-foreground">인감:</span>
                      <img
                        src={p.stamp_url}
                        alt="인감"
                        className="size-12 rounded border bg-white object-contain"
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  미설정 — {aliasOfSL ? "사업자(SL) 카드에서 등록" : "편집 버튼으로 등록"}
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
