import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BookBadge } from "@/components/admin/book-badge";
import { NoteCell } from "@/components/admin/note-cell";
import { fmtKrw } from "@/lib/format";
import {
  RECEIPT_PAY_METHOD_LABEL,
  TAX_DOC_LABEL,
  isReceiptUnpaid,
  summarizeReceipts,
  type ReceiptListRow,
} from "@/lib/receipt";

/** 홈택스 자동 생성 배지 — 매입 목록과 같은 모양(주황). */
function HometaxBadge({ originRef }: { originRef: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-orange-100 px-1 py-0 text-[9px] font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
      title={`홈택스 매입 계산서로 자동 생성${originRef ? ` · 승인 …${originRef.slice(-6)}` : ""}`}
    >
      <span className="size-1.5 rounded-full bg-orange-500" />
      홈택스
    </span>
  );
}

function PayCell({ r }: { r: ReceiptListRow }) {
  if (isReceiptUnpaid(r)) {
    return (
      <span
        className="inline-flex h-5 items-center rounded-full bg-amber-100 px-2 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
        title="결제수단·결제 통장이 아직 없음"
      >
        미지급
      </span>
    );
  }
  const method = r.pay_method ? (RECEIPT_PAY_METHOD_LABEL[r.pay_method] ?? r.pay_method) : null;
  const acct = r.pay_bank_account ? `${r.pay_bank_account.bank_name} ${r.pay_bank_account.code}` : null;
  return (
    <div className="text-xs">
      <div>{method ?? "결제"}</div>
      {acct ? <div className="text-muted-foreground">{acct}</div> : null}
    </div>
  );
}

/** 영수증·비용 목록 테이블 + 합계 줄. 목록 전용(수정·삭제·상세 링크 없음). */
export function ReceiptTable({ receipts }: { receipts: ReceiptListRow[] }) {
  const sum = summarizeReceipts(receipts);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          총 <span className="font-medium text-foreground">{sum.count}</span>건
        </span>
        <span>
          합계 <span className="font-medium tabular-nums text-foreground">{fmtKrw(sum.total)}</span>
        </span>
        {sum.unpaidCount > 0 ? (
          <span>
            미지급 <span className="font-medium tabular-nums text-amber-700 dark:text-amber-300">{fmtKrw(sum.unpaid)}</span>
            <span className="ml-1 text-xs">({sum.unpaidCount}건)</span>
          </span>
        ) : null}
        {sum.hometax > 0 ? <span className="text-xs">홈택스 생성 {sum.hometax}건</span> : null}
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">영수일</TableHead>
              <TableHead className="w-20">책</TableHead>
              <TableHead className="w-44">거래처</TableHead>
              <TableHead className="w-24">분류</TableHead>
              <TableHead className="w-32 text-right">금액</TableHead>
              <TableHead className="w-44">자료</TableHead>
              <TableHead className="w-28 text-center">결제</TableHead>
              <TableHead>비고</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  이 달에 등록된 영수증이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              receipts.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">
                    <div>{r.receipt_on}</div>
                    {r.origin === "hometax" ? (
                      <div className="mt-0.5">
                        <HometaxBadge originRef={r.origin_ref} />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <BookBadge book={r.book} />
                  </TableCell>
                  <TableCell className="font-medium">{r.partner?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.category}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div>{fmtKrw(Number(r.amount_krw))}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.vat_included ? "부가세 포함" : "부가세 별도"}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{TAX_DOC_LABEL[r.tax_doc_type] ?? r.tax_doc_type}</div>
                    {r.tax_doc_no ? (
                      <div className="font-mono text-[10px] text-muted-foreground">{r.tax_doc_no}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-center">
                    <PayCell r={r} />
                  </TableCell>
                  <TableCell>
                    <NoteCell text={r.notes} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {receipts.length > 0 ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>합계 {sum.count}건</TableCell>
                <TableCell className="text-right tabular-nums">{fmtKrw(sum.total)}</TableCell>
                <TableCell colSpan={3} className="text-xs font-normal text-muted-foreground">
                  {sum.unpaidCount > 0 ? `미지급 ${fmtKrw(sum.unpaid)} (${sum.unpaidCount}건)` : "미지급 없음"}
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
    </>
  );
}
