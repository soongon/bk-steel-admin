import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type BookView, BOOK_VIEW_LABEL } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import {
  isValidMonth,
  kstCurrentMonth,
  monthRange,
  shiftMonth,
  type ReceiptListRow,
} from "@/lib/receipt";
import { ReceiptTable } from "./receipt-table";

/**
 * 영수증·비용 목록(최소 기능) — 월 단위 조회 + 홈택스 자동 생성(0092) 필터 + 합계.
 * 수정·삭제·결제 처리는 아직 없음. 책 격리는 RLS(p_receipt_read, viewer) + 책 뷰 필터.
 * B계좌(b)는 무자료(tax_doc_type='none')만 있으나 목록 규칙은 같다.
 */
export default async function ReceiptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ book: string }>;
  searchParams: Promise<{ month?: string; origin?: string }>;
}) {
  const { book } = await params;
  const sp = await searchParams;
  const view = book as BookView;
  const supabase = await createClient();

  const month = isValidMonth(sp.month) ? sp.month : kstCurrentMonth();
  const { start, end } = monthRange(month);
  const origin = sp.origin === "hometax" ? "hometax" : undefined; // hometax = 홈택스 매입 계산서 수집본에서 자동 생성(0092)

  let q = supabase
    .from("receipt")
    .select(
      `
      id, book, receipt_on, category, amount_krw, vat_included, tax_doc_type, tax_doc_no,
      pay_method, pay_bank_account_id, notes, origin, origin_ref,
      partner:partner(id, name, code),
      pay_bank_account:bank_account(id, code, bank_name)
    `,
    )
    .is("deleted_at", null)
    .gte("receipt_on", start)
    .lt("receipt_on", end)
    .order("receipt_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (view !== "all") q = q.eq("book", view);
  if (origin) q = q.eq("origin", origin);

  const res = await q;
  const receipts = (res.data as unknown as ReceiptListRow[]) ?? [];

  const base = `/${view}/receipts`;
  const withParams = (m: string, o?: string) =>
    `${base}?month=${m}${o ? `&origin=${o}` : ""}`;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">영수증·비용</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {BOOK_VIEW_LABEL[view]} 보기 · {month.replace("-", "년 ")}월 · 식대·연료비·임차료 등 비용 영수증
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <Link
              href={withParams(month)}
              className={`rounded-full border px-2.5 py-0.5 ${!origin ? "bg-foreground text-background" : "hover:bg-muted"}`}
            >
              전체
            </Link>
            <Link
              href={withParams(month, "hometax")}
              className={`rounded-full border px-2.5 py-0.5 ${origin === "hometax" ? "bg-foreground text-background" : "hover:bg-muted"}`}
            >
              홈택스 생성
            </Link>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <BookBadge book={view} size="md" />
          {/* 월 이동 — 세금계산서 화면과 같은 모양. origin 칩은 유지 */}
          <div className="flex items-center gap-1">
            <Link
              href={withParams(shiftMonth(month, -1), origin)}
              className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted"
              aria-label="이전 달"
            >
              <ChevronLeftIcon className="size-4" />
            </Link>
            <form className="contents">
              {origin ? <input type="hidden" name="origin" value={origin} /> : null}
              <input
                type="month"
                name="month"
                defaultValue={month}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              />
              <button type="submit" className="h-8 rounded-md border px-2 text-sm hover:bg-muted">
                조회
              </button>
            </form>
            <Link
              href={withParams(shiftMonth(month, 1), origin)}
              className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted"
              aria-label="다음 달"
            >
              <ChevronRightIcon className="size-4" />
            </Link>
          </div>
        </div>
      </header>

      {res.error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          데이터 로딩 실패: {res.error.message}
        </div>
      ) : null}

      <ReceiptTable receipts={receipts} />
    </div>
  );
}
