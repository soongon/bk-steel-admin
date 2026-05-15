"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircleIcon,
  FileSignatureIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XCircleIcon,
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
  SaleFormDialog,
  type Partner,
  type Item,
  type RebarSpec,
  type SaleRow,
  type SiteOption,
} from "./sale-form-dialog";
import { cancelSale, deleteSale, settleSale } from "./actions";

type SaleLine = {
  id: string;
  qty: number;
  unit: string;
  unit_price_krw: number;
  item: { id: string; name: string; code: string } | null;
};

export type SaleListRow = {
  id: string;
  book: Book;
  doc_no: string;
  ordered_on: string;
  delivered_on: string | null;
  status: string;
  subtotal_krw: number;
  vat_krw: number;
  total_krw: number;
  site_name: string | null;
  is_documented: boolean;
  tax_doc_type: string;
  payment_due_on: string | null;
  settled_on: string | null;
  partner_id: string;
  site_id: string | null;
  delivery_cert_id: string | null;
  notes: string | null;
  partner: { id: string; name: string; code: string } | null;
  site: { id: string; name: string; code: string } | null;
  sale_line: SaleLine[];
};

const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  reserved:  { label: "주문",     className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
  confirmed: { label: "확정",     className: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  delivered: { label: "납품완료", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" },
  settled:   { label: "수금완료", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  overdue:   { label: "연체",     className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
  cancelled: { label: "취소",     className: "bg-zinc-200 text-zinc-600 line-through dark:bg-zinc-800 dark:text-zinc-400" },
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

export function SaleTable({
  sales,
  partners,
  items,
  rebarSpecs,
  sites,
  view,
  attachmentsByEntity,
}: {
  sales: SaleListRow[];
  partners: Partner[];
  items: Item[];
  rebarSpecs: RebarSpec[];
  sites: SiteOption[];
  view: BookView;
  attachmentsByEntity?: Record<string, import("@/lib/attachment").Attachment[]>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SaleRow | null>(null);
  const [, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(s: SaleListRow) {
    setEditing({
      id: s.id,
      book: s.book,
      doc_no: s.doc_no,
      partner_id: s.partner_id,
      site_id: s.site_id,
      site_name: s.site?.name ?? s.site_name,
      ordered_on: s.ordered_on,
      delivered_on: s.delivered_on,
      status: s.status,
      is_documented: s.is_documented,
      tax_doc_type: s.tax_doc_type,
      payment_due_on: s.payment_due_on,
      notes: s.notes,
    });
    setOpen(true);
  }
  function handleSettle(s: SaleListRow) {
    if (s.status === "settled") return;
    if (!window.confirm(`[${s.doc_no}] 수금완료로 처리하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await settleSale(s.id);
      if (r.ok) toast.success("수금완료 처리됨");
      else toast.error(r.error);
    });
  }
  function handleCancel(s: SaleListRow) {
    if (s.status === "cancelled") return;
    if (!window.confirm(`[${s.doc_no}] 매출을 취소하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await cancelSale(s.id);
      if (r.ok) toast.success("취소됨");
      else toast.error(r.error);
    });
  }
  function handleDelete(s: SaleListRow) {
    if (!window.confirm(`[${s.doc_no}] 완전 삭제? (soft delete)`)) return;
    startTransition(async () => {
      const r = await deleteSale(s.id);
      if (r.ok) toast.success("삭제됨");
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          총 <span className="font-medium text-foreground">{sales.length}</span>건
        </p>
        <Button onClick={openCreate} size="sm">
          <PlusIcon className="size-4" />
          신규 매출
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">문서</TableHead>
              <TableHead className="w-24">책</TableHead>
              <TableHead className="w-28">날짜</TableHead>
              <TableHead className="w-44">거래처 · 현장</TableHead>
              <TableHead>품목</TableHead>
              <TableHead className="w-28 text-right">합계</TableHead>
              <TableHead className="w-24 text-center">상태</TableHead>
              <TableHead className="w-20">메모</TableHead>
              <TableHead className="w-32 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                  등록된 매출이 없습니다.{" "}
                  <button onClick={openCreate} className="underline">신규 추가</button>
                </TableCell>
              </TableRow>
            ) : (
              sales.map((s) => {
                const firstLine = s.sale_line?.[0];
                const itemSummary = firstLine
                  ? `${firstLine.item?.name ?? "—"} · ${firstLine.qty}${firstLine.unit}`
                  : "—";
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/${view}/sales/${s.id}`}
                        className="hover:underline"
                      >
                        {s.doc_no}
                      </Link>
                      {!s.is_documented ? (
                        <div className="text-[10px] text-amber-600">무자료</div>
                      ) : null}
                      {s.delivery_cert_id ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0 text-[9px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" />
                            }
                          >
                            <FileSignatureIcon className="size-2.5" />
                            확인서
                          </TooltipTrigger>
                          <TooltipContent>납품확인서 발급됨</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <BookBadge book={s.book} />
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{s.ordered_on}</div>
                      {s.settled_on ? (
                        <div className="text-muted-foreground">수금 {s.settled_on}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{s.partner?.name ?? "—"}</div>
                      {s.site?.name || s.site_name ? (
                        <div className="text-xs text-muted-foreground">
                          {s.site?.id ? (
                            <Link
                              href={`/${view}/sites/${s.site.id}`}
                              className="hover:underline"
                            >
                              {s.site.name}
                              <span className="ml-1 font-mono text-[10px] text-muted-foreground/70">
                                {s.site.code}
                              </span>
                            </Link>
                          ) : (
                            s.site_name
                          )}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{itemSummary}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtKrw(s.total_krw)}
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell>
                      <NoteCell text={s.notes} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        {s.status !== "settled" && s.status !== "cancelled" ? (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleSettle(s)}
                            aria-label="수금완료"
                          >
                            <CheckCircleIcon className="text-emerald-600" />
                          </Button>
                        ) : null}
                        <Button size="icon-xs" variant="ghost" onClick={() => openEdit(s)} aria-label="수정">
                          <PencilIcon />
                        </Button>
                        {s.status !== "cancelled" ? (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleCancel(s)}
                            aria-label="취소"
                          >
                            <XCircleIcon className="text-zinc-500" />
                          </Button>
                        ) : null}
                        <Button size="icon-xs" variant="ghost" onClick={() => handleDelete(s)} aria-label="삭제">
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

      <SaleFormDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        view={view}
        partners={partners}
        items={items}
        rebarSpecs={rebarSpecs}
        sites={sites}
        attachments={editing ? attachmentsByEntity?.[editing.id] ?? [] : []}
      />
    </>
  );
}
