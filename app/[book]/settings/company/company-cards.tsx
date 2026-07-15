"use client";

import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type Book, BOOK_LABEL, BOOKS } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { type CompanyProfile } from "@/lib/company-profile";
import { formatBusinessNo, formatPhone } from "@/lib/format";
import { CompanyFormDialog } from "./company-form-dialog";

export function CompanyCards({ profiles }: { profiles: CompanyProfile[] }) {
  const byBook = new Map(profiles.map((p) => [p.book, p]));
  const [editing, setEditing] = useState<Book | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {BOOKS.map((book) => {
          // B계좌는 SL 사업자의 무자료 흐름 — 상호·사업자번호는 SL과 동일하되 입금계좌·계좌사본은
          // 히든 통장(SL 공식계좌와 다름)이라 별도 편집. b row 없으면 표시·프리필은 SL 폴백.
          const isBBook = book === "b";
          const own = byBook.get(book); // 이 책의 자체 row
          const p = own ?? (isBBook ? byBook.get("sl") : undefined); // 표시용(B 미설정 시 SL)
          const usingSLFallback = isBBook && !own;
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

              {isBBook ? (
                <p className="mb-2 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                  B계좌는 SL 사업자의 무자료 흐름 — 상호·사업자번호는 SL과 동일하게 두고, <b>입금계좌·계좌사본만</b> B계좌(히든 통장)로 넣으세요.
                  {usingSLFallback ? " (현재 미설정 — SL 정보 표시 중)" : ""}
                </p>
              ) : null}

              {p ? (
                <>
                  <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                    <Row label="상호" value={p.name} bold />
                    <Row label="사업자번호" value={formatBusinessNo(p.business_no)} mono />
                    <Row label="대표자" value={p.representative} />
                    <Row label="업태/종목" value={joinSlash(p.business_type, p.business_item)} />
                    <Row label="주소" value={p.address} colSpan />
                    <Row label="전화" value={p.phone ? formatPhone(p.phone) : p.phone} />
                    <Row label="팩스" value={p.fax ? formatPhone(p.fax) : p.fax} />
                    <Row label="휴대폰" value={p.mobile ? formatPhone(p.mobile) : p.mobile} />
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
                  {p.stamp_url || p.bank_copy_url ? (
                    <div className="mt-3 flex items-center gap-4 border-t pt-3">
                      {p.stamp_url ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">인감:</span>
                          <img src={p.stamp_url} alt="인감" className="size-12 rounded border bg-white object-contain" />
                        </div>
                      ) : null}
                      {p.bank_copy_url ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">계좌사본:</span>
                          <img src={p.bank_copy_url} alt="계좌사본" className="h-12 w-20 rounded border bg-white object-contain" />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">미설정 — 편집 버튼으로 등록</p>
              )}
            </div>
          );
        })}
      </div>

      <CompanyFormDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        book={editing ?? "bk"}
        // B 편집 시 자체 row 없으면 SL 을 프리필(상호·사업자번호 동일 시작, 계좌만 변경).
        profile={
          editing
            ? byBook.get(editing) ?? (editing === "b" ? byBook.get("sl") ?? null : null)
            : null
        }
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
