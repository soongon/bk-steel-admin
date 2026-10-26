"use client";

import { useState, useTransition } from "react";
import { STEEL_CUSTOM_ITEM_ID } from "@/lib/transaction-draft";
import Link from "next/link";
import {
  CheckCircleIcon,
  FileSignatureIcon,
  PlusIcon,
  Trash2Icon,
  TruckIcon,
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
import { type CompanyProfile } from "@/lib/company-profile";
import { BookBadge } from "@/components/admin/book-badge";
import { NoteCell, NoteLogBadge } from "@/components/admin/note-cell";
import { LinkSpinner } from "@/components/admin/link-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  SaleFormDialog,
  type Partner,
  type Item,
  type RebarSpec,
  type SaleRow,
  type SiteOption,
} from "./sale-form-dialog";
import { cancelSale, deleteSale, markSaleDelivered } from "./actions";
import { fmtKrw } from "@/lib/format";
import { saleLifecycleProgress, deliveryDday } from "@/lib/sale-lifecycle";
import { SettleDialog, type BankAccount } from "./settle-dialog";

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
  statement_sent_on: string | null;
  tax_invoice_issued_on: string | null;
  partner_id: string;
  site_id: string | null;
  delivery_cert_id: string | null;
  notes: string | null;
  /** 출처(0087) — hometax: 홈택스 수집본에서 자동 생성. 라인이 금액 1줄(철제 직접입력)뿐이면 '품목 미정' */
  origin?: string | null;
  origin_ref?: string | null;
  /** 상세에서 남긴 메모 기록(0080) — 건수와 가장 최근 1건. */
  memo_count?: Array<{ count: number }>;
  latest_memo?: Array<{ body: string; created_at: string }>;
  partner: { id: string; name: string; code: string } | null;
  site: { id: string; name: string; code: string } | null;
  sale_line: SaleLine[];
};

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  reserved:  { label: "주문",     className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
  confirmed: { label: "확정",     className: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  delivered: { label: "납품완료", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" },
  settled:   { label: "수금완료", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  overdue:   { label: "연체",     className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
  cancelled: { label: "취소",     className: "bg-zinc-200 text-zinc-600 line-through dark:bg-zinc-800 dark:text-zinc-400" },
};

/** 홈택스 생성 매출의 라인이 아직 금액 1줄(철제 직접입력, 수량 1)뿐인지 — 품목·중량 미정. */
function isItemsPending(s: SaleListRow): boolean {
  const lines = s.sale_line ?? [];
  return lines.length > 0 && lines.every((l) => l.item?.id === STEEL_CUSTOM_ITEM_ID && Number(l.qty) === 1 && l.unit === "ea");
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, className: "" };
  return (
    <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${s.className}`}>
      {s.label}
    </span>
  );
}

/** 거래 라이프사이클 진행률 — 6단계 중 완료 수(목록 배지). 상세의 SaleLifecyclePanel 과 같은 기준. */
function ProgressBadge({ s }: { s: SaleListRow }) {
  const { done, total } = saleLifecycleProgress(s);
  const full = done === total;
  return (
    <div
      className={`mt-0.5 text-[10px] tabular-nums ${full ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
    >
      {done}/{total}단계
    </div>
  );
}

const GRADE_META: Record<string, { label: string; className: string }> = {
  normal: { label: "정상", className: "text-muted-foreground" },
  short: { label: "단기", className: "text-yellow-600 dark:text-yellow-400" },
  mid: { label: "중기", className: "text-orange-600 dark:text-orange-400" },
  long: { label: "장기", className: "font-semibold text-red-600 dark:text-red-400" },
};

/** 미수 등급 — vw_receivable 과 동일 기준(정상/단기1~7/중기8~30/장기31+). 수금완료·취소는 미수 아님. */
function receivable(s: SaleListRow): { grade: string | null; days: number } {
  if (s.status === "settled" || s.status === "cancelled") return { grade: null, days: 0 };
  if (!s.payment_due_on) return { grade: "normal", days: 0 };
  const due = new Date(s.payment_due_on + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  if (days <= 0) return { grade: "normal", days };
  if (days <= 7) return { grade: "short", days };
  if (days <= 30) return { grade: "mid", days };
  return { grade: "long", days };
}

function ReceivableCell({ s }: { s: SaleListRow }) {
  const { grade, days } = receivable(s);
  if (!grade) return <span className="text-muted-foreground">—</span>;
  const meta = GRADE_META[grade];
  return (
    <span className={`text-xs ${meta.className}`}>
      {meta.label}
      {days > 0 ? <span className="ml-0.5 tabular-nums">+{days}d</span> : null}
    </span>
  );
}

export function SaleTable({
  sales,
  partners,
  items,
  rebarSpecs,
  sites,
  bankAccounts,
  companies,
  view,
  gradeFilter = "",
}: {
  sales: SaleListRow[];
  partners: Partner[];
  items: Item[];
  rebarSpecs: RebarSpec[];
  sites: SiteOption[];
  bankAccounts: BankAccount[];
  companies: CompanyProfile[];
  view: BookView;
  gradeFilter?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SaleRow | null>(null);
  const [settleTarget, setSettleTarget] = useState<SaleListRow | null>(null);
  const [, startTransition] = useTransition();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }); // KST 'YYYY-MM-DD'

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function handleDeliver(s: SaleListRow) {
    if (!window.confirm(`[${s.doc_no}] 납품완료로 처리하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await markSaleDelivered(s.id);
      if (r.ok) toast.success("납품완료 처리됨");
      else toast.error(r.error);
    });
  }
  function handleSettle(s: SaleListRow) {
    setSettleTarget(s);
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

  // 미수등급 필터는 클라에서(날짜 파생). 나머지 필터는 서버 쿼리에서 이미 적용됨.
  const filtered = gradeFilter
    ? sales.filter((s) => receivable(s).grade === gradeFilter)
    : sales;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          총 <span className="font-medium text-foreground">{filtered.length}</span>건
          {gradeFilter && filtered.length !== sales.length ? ` / ${sales.length}` : ""}
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
              <TableHead className="w-16 text-center">미수</TableHead>
              <TableHead className="w-24">메모</TableHead>
              <TableHead className="w-32 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                  {sales.length === 0 ? (
                    <>
                      등록된 매출이 없습니다.{" "}
                      <button onClick={openCreate} className="underline">신규 추가</button>
                    </>
                  ) : (
                    "필터 조건에 맞는 매출이 없습니다."
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => {
                const firstLine = s.sale_line?.[0];
                const lineCount = s.sale_line?.length ?? 0;
                const itemSummary = firstLine
                  ? `${firstLine.item?.name ?? "—"} · ${firstLine.qty}${firstLine.unit}${lineCount > 1 ? ` 외 ${lineCount - 1}건` : ""}`
                  : "—";
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/${view}/sales/${s.id}`}
                        className="hover:underline"
                      >
                        {s.doc_no}
                        <LinkSpinner />
                      </Link>
                      {!s.is_documented ? (
                        <div className="text-[10px] text-amber-600">무자료</div>
                      ) : null}
                      {s.origin === "hometax" ? (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="inline-flex items-center gap-1 rounded bg-orange-100 px-1 py-0 text-[9px] font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" />
                              }
                            >
                              <span className="size-1.5 rounded-full bg-orange-500" />
                              홈택스
                            </TooltipTrigger>
                            <TooltipContent>홈택스 직접 발행 계산서로 자동 생성된 매출{s.origin_ref ? ` · 승인 …${s.origin_ref.slice(-6)}` : ""}</TooltipContent>
                          </Tooltip>
                          {isItemsPending(s) ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={<span className="inline-flex items-center rounded border border-red-300 px-1 py-0 text-[9px] font-medium text-red-700 dark:border-red-800 dark:text-red-300" />}
                              >
                                품목 미정
                              </TooltipTrigger>
                              <TooltipContent>금액 1줄만 있고 품목·중량이 없어 재고에 안 잡힘 — 수정에서 품목을 채우세요</TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
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
                      {s.delivered_on ? (
                        ["delivered", "settled", "overdue"].includes(s.status) ? (
                          <div className="text-emerald-700 dark:text-emerald-400">납품 {s.delivered_on}</div>
                        ) : s.delivered_on > today ? (
                          <div className="text-amber-600 dark:text-amber-400">예정 {s.delivered_on}</div>
                        ) : (
                          <div
                            className={
                              s.delivered_on === today
                                ? "text-blue-600 dark:text-blue-400"
                                : "text-red-600 dark:text-red-400"
                            }
                          >
                            {deliveryDday(s.delivered_on, today).label} 예정 {s.delivered_on}
                          </div>
                        )
                      ) : null}
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
                      <ProgressBadge s={s} />
                    </TableCell>
                    <TableCell className="text-center">
                      <ReceivableCell s={s} />
                    </TableCell>
                    <TableCell>
                      {/* 등록 메모(sale.notes) + 상세에서 남긴 기록 건수(툴팁에 최근 1건) */}
                      <div className="flex flex-wrap items-center gap-1">
                        {s.notes || !s.memo_count?.[0]?.count ? <NoteCell text={s.notes} /> : null}
                        {s.memo_count?.[0]?.count ? (
                          <NoteLogBadge count={s.memo_count[0].count} latest={s.latest_memo?.[0] ?? null} />
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        {s.status === "reserved" || s.status === "confirmed" ? (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleDeliver(s)}
                            aria-label="납품완료"
                          >
                            <TruckIcon className="text-indigo-600" />
                          </Button>
                        ) : null}
                        {s.status === "delivered" || s.status === "overdue" ? (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleSettle(s)}
                            aria-label="수금완료"
                          >
                            <CheckCircleIcon className="text-emerald-600" />
                          </Button>
                        ) : null}
                        {s.status !== "cancelled" && s.status !== "settled" ? (
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
        companies={companies}
      />

      {settleTarget ? (
        <SettleDialog
          sale={settleTarget}
          bankAccounts={bankAccounts}
          onClose={() => setSettleTarget(null)}
        />
      ) : null}
    </>
  );
}

