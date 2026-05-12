"use client";

import { useState, useTransition } from "react";
import {
  BanknoteIcon,
  PackageCheckIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { type Book, type BookView } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PurchaseFormDialog,
  type Partner,
  type Item,
  type RebarSpec,
  type PurchaseRow,
} from "./purchase-form-dialog";
import { deletePurchase, markPurchasePaid, markPurchaseReceived } from "./actions";

type PurchaseLine = {
  id: string;
  acquired_qty: number;
  acquired_unit: string;
  unit_price_krw: number;
  actual_weight_kg: number | null;
  theoretical_weight_kg: number | null;
  item: { id: string; name: string; code: string } | null;
};

export type PurchaseListRow = {
  id: string;
  book: Book;
  doc_no: string;
  ordered_on: string;
  delivered_on: string | null;
  paid_on: string | null;
  payment_due_on: string | null;
  status: string;
  subtotal_krw: number;
  vat_krw: number;
  total_krw: number;
  is_documented: boolean;
  tax_doc_type: string;
  tax_doc_no: string | null;
  partner_id: string;
  notes: string | null;
  partner: { id: string; name: string; code: string } | null;
  purchase_line: PurchaseLine[];
};

const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  ordered:         { label: "발주",     className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
  in_stock:        { label: "입고완료", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  partial_out:     { label: "일부 출고",className: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  depleted:        { label: "전량 출고",className: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  transferred_out: { label: "이관",     className: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300" },
  scrapped:        { label: "폐기",     className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, className: "" };
  return (
    <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${s.className}`}>
      {s.label}
    </span>
  );
}

const NOTE_PREVIEW_LEN = 5;

function NoteCell({ text }: { text: string | null }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  const isLong = text.length > NOTE_PREVIEW_LEN;
  const preview = isLong ? text.slice(0, NOTE_PREVIEW_LEN) + "…" : text;
  if (!isLong) return <span className="text-xs text-muted-foreground">{preview}</span>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="cursor-help text-xs text-muted-foreground underline decoration-dotted underline-offset-2" />
        }
      >
        {preview}
      </TooltipTrigger>
      <TooltipContent className="max-w-md whitespace-pre-wrap">{text}</TooltipContent>
    </Tooltip>
  );
}

function PaidBadge({ paidOn, dueOn }: { paidOn: string | null; dueOn: string | null }) {
  if (paidOn) {
    return (
      <span className="inline-flex h-5 items-center rounded-full bg-emerald-100 px-2 text-xs text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        결제 {paidOn}
      </span>
    );
  }
  if (dueOn) {
    return (
      <span className="text-xs text-muted-foreground">
        예정 {dueOn}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

export function PurchaseTable({
  purchases,
  partners,
  items,
  rebarSpecs,
  view,
}: {
  purchases: PurchaseListRow[];
  partners: Partner[];
  items: Item[];
  rebarSpecs: RebarSpec[];
  view: BookView;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  const [, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(p: PurchaseListRow) {
    setEditing({
      id: p.id,
      book: p.book,
      doc_no: p.doc_no,
      partner_id: p.partner_id,
      ordered_on: p.ordered_on,
      delivered_on: p.delivered_on,
      paid_on: p.paid_on,
      payment_due_on: p.payment_due_on,
      status: p.status,
      is_documented: p.is_documented,
      tax_doc_type: p.tax_doc_type,
      tax_doc_no: p.tax_doc_no,
      notes: p.notes,
    });
    setOpen(true);
  }
  function handleReceived(p: PurchaseListRow) {
    if (p.status !== "ordered") return;
    if (!window.confirm(`[${p.doc_no}] 입고완료로 처리하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await markPurchaseReceived(p.id);
      if (r.ok) toast.success("입고완료 처리됨");
      else toast.error(r.error);
    });
  }
  function handlePaid(p: PurchaseListRow) {
    if (p.paid_on) return;
    if (!window.confirm(`[${p.doc_no}] 결제완료로 처리하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await markPurchasePaid(p.id);
      if (r.ok) toast.success("결제완료 처리됨");
      else toast.error(r.error);
    });
  }
  function handleDelete(p: PurchaseListRow) {
    if (!window.confirm(`[${p.doc_no}] 완전 삭제? (soft delete)`)) return;
    startTransition(async () => {
      const r = await deletePurchase(p.id);
      if (r.ok) toast.success("삭제됨");
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          총 <span className="font-medium text-foreground">{purchases.length}</span>건
        </p>
        <Button onClick={openCreate} size="sm">
          <PlusIcon className="size-4" />
          신규 매입
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">문서</TableHead>
              <TableHead className="w-24">책</TableHead>
              <TableHead className="w-28">날짜</TableHead>
              <TableHead className="w-44">매입처</TableHead>
              <TableHead>품목</TableHead>
              <TableHead className="w-28 text-right">합계</TableHead>
              <TableHead className="w-24 text-center">상태</TableHead>
              <TableHead className="w-32 text-center">결제</TableHead>
              <TableHead className="w-20">메모</TableHead>
              <TableHead className="w-32 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                  등록된 매입이 없습니다.{" "}
                  <button onClick={openCreate} className="underline">신규 추가</button>
                </TableCell>
              </TableRow>
            ) : (
              purchases.map((p) => {
                const firstLine = p.purchase_line?.[0];
                let itemSummary = "—";
                if (firstLine) {
                  const w = firstLine.actual_weight_kg ?? firstLine.theoretical_weight_kg;
                  const wStr = w ? ` (${Math.round(w).toLocaleString()}kg)` : "";
                  itemSummary = `${firstLine.item?.name ?? "—"} · ${firstLine.acquired_qty}${firstLine.acquired_unit}${wStr}`;
                }
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">
                      <div>{p.doc_no}</div>
                      {!p.is_documented ? (
                        <span className="text-[10px] text-amber-600">무자료</span>
                      ) : null}
                      {p.tax_doc_no ? (
                        <span className="text-[10px] text-muted-foreground">{p.tax_doc_no}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <BookBadge book={p.book} />
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{p.ordered_on}</div>
                      {p.delivered_on && p.delivered_on !== p.ordered_on ? (
                        <div className="text-muted-foreground">입고 {p.delivered_on}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{p.partner?.name ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-sm">{itemSummary}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtKrw(p.total_krw)}
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      <PaidBadge paidOn={p.paid_on} dueOn={p.payment_due_on} />
                    </TableCell>
                    <TableCell>
                      <NoteCell text={p.notes} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        {p.status === "ordered" ? (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleReceived(p)}
                            aria-label="입고완료"
                          >
                            <PackageCheckIcon className="text-emerald-600" />
                          </Button>
                        ) : null}
                        {!p.paid_on ? (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handlePaid(p)}
                            aria-label="결제완료"
                          >
                            <BanknoteIcon className="text-blue-600" />
                          </Button>
                        ) : null}
                        <Button size="icon-xs" variant="ghost" onClick={() => openEdit(p)} aria-label="수정">
                          <PencilIcon />
                        </Button>
                        <Button size="icon-xs" variant="ghost" onClick={() => handleDelete(p)} aria-label="삭제">
                          <Trash2Icon className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <PurchaseFormDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        view={view}
        partners={partners}
        items={items}
        rebarSpecs={rebarSpecs}
      />
    </>
  );
}
