"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CreditCardIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  PhoneCallIcon,
  PlusIcon,
  Trash2Icon,
  Building2Icon,
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
import {
  BusinessCardFormDialog,
  type BusinessCardRow,
  type PartnerOption,
} from "./business-card-form-dialog";
import { deleteBusinessCard } from "./actions";
import { type Attachment } from "@/lib/attachment";

export type BusinessCardWithMeta = BusinessCardRow & {
  partner: { code: string; name: string } | null;
  thumbnail_url: string | null;       // 첫 attachment URL (카드뷰 표시용)
  sales_count: number;                 // sales_log.business_card_id 카운트
  attachments: Attachment[];           // 편집 다이얼로그에 prefill용
};

type View = "card" | "table";

export function BusinessCardViews({
  rows,
  partners,
  book,
}: {
  rows: BusinessCardWithMeta[];
  partners: PartnerOption[];
  book: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("card");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessCardWithMeta | null>(null);
  const [, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(r: BusinessCardWithMeta) {
    setEditing(r);
    setOpen(true);
  }
  function handleDelete(r: BusinessCardWithMeta) {
    if (!window.confirm(`명함 [${r.name}${r.company ? ` / ${r.company}` : ""}]를 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await deleteBusinessCard(r.id);
      if (result.ok) {
        toast.success("삭제되었습니다");
        router.refresh();
      } else toast.error(result.error);
    });
  }

  function goToSalesLog(r: BusinessCardWithMeta) {
    router.push(`/${book}/sales-log?from_card=${r.id}`);
  }
  function goToPartner(r: BusinessCardWithMeta) {
    if (r.partner_id) {
      // 이미 매핑됨 → 거래처 페이지로 (단순 이동)
      router.push(`/${book}/partners`);
    } else {
      router.push(`/${book}/partners?from_card=${r.id}`);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          총 <span className="font-medium text-foreground">{rows.length}</span>건
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setView("card")}
              aria-label="카드 보기"
              className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs ${
                view === "card" ? "bg-zinc-200 dark:bg-zinc-700" : "text-muted-foreground"
              }`}
            >
              <LayoutGridIcon className="size-3.5" />
              카드
            </button>
            <button
              type="button"
              onClick={() => setView("table")}
              aria-label="테이블 보기"
              className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs ${
                view === "table" ? "bg-zinc-200 dark:bg-zinc-700" : "text-muted-foreground"
              }`}
            >
              <ListIcon className="size-3.5" />
              테이블
            </button>
          </div>
          <Button onClick={openCreate} size="sm">
            <PlusIcon className="size-4" />
            신규 명함
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center text-sm text-muted-foreground">
          등록된 명함이 없습니다.{" "}
          <button onClick={openCreate} className="underline">
            신규 추가
          </button>
        </div>
      ) : view === "card" ? (
        <CardGrid
          rows={rows}
          onEdit={openEdit}
          onDelete={handleDelete}
          onSalesLog={goToSalesLog}
          onPartner={goToPartner}
        />
      ) : (
        <TableView
          rows={rows}
          onEdit={openEdit}
          onDelete={handleDelete}
          onSalesLog={goToSalesLog}
          onPartner={goToPartner}
        />
      )}

      <BusinessCardFormDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        partners={partners}
        attachments={editing?.attachments ?? []}
      />
    </>
  );
}

type ActionProps = {
  rows: BusinessCardWithMeta[];
  onEdit: (r: BusinessCardWithMeta) => void;
  onDelete: (r: BusinessCardWithMeta) => void;
  onSalesLog: (r: BusinessCardWithMeta) => void;
  onPartner: (r: BusinessCardWithMeta) => void;
};

function CardGrid({ rows, onEdit, onDelete, onSalesLog, onPartner }: ActionProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((r) => (
        <CardItem
          key={r.id}
          row={r}
          onEdit={() => onEdit(r)}
          onDelete={() => onDelete(r)}
          onSalesLog={() => onSalesLog(r)}
          onPartner={() => onPartner(r)}
        />
      ))}
    </div>
  );
}

function CardItem({
  row,
  onEdit,
  onDelete,
  onSalesLog,
  onPartner,
}: {
  row: BusinessCardWithMeta;
  onEdit: () => void;
  onDelete: () => void;
  onSalesLog: () => void;
  onPartner: () => void;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      {/* 명함 사진 영역 (1.6:1 비율) */}
      <div className="relative aspect-[1.6/1] bg-muted">
        {row.thumbnail_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={row.thumbnail_url} alt={row.name} className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <CreditCardIcon className="size-10 opacity-30" />
          </div>
        )}
      </div>
      {/* 정보 */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate font-semibold leading-tight">{row.name}</h3>
            {row.collected_on ? (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {row.collected_on}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {row.title ?? "—"}
            {row.company ? ` / ${row.company}` : ""}
          </p>
        </div>
        {row.phone || row.email ? (
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {row.phone ? <p>📞 {row.phone}</p> : null}
            {row.email ? <p className="truncate">✉ {row.email}</p> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          {row.partner ? (
            <Badge tone="emerald" icon={<Building2Icon className="size-3" />}>
              {row.partner.name}
            </Badge>
          ) : (
            <Badge tone="amber">잠재</Badge>
          )}
          {row.sales_count > 0 ? (
            <Badge tone="blue" icon={<PhoneCallIcon className="size-3" />}>
              영업 {row.sales_count}건
            </Badge>
          ) : null}
        </div>
        {/* 액션 */}
        <div className="mt-auto grid grid-cols-2 gap-1 pt-2">
          <Button size="xs" variant="outline" onClick={onSalesLog}>
            <ArrowRightIcon className="size-3" />
            영업내역
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={onPartner}
            disabled={!!row.partner_id}
          >
            <ArrowRightIcon className="size-3" />
            {row.partner_id ? "거래처 등록됨" : "거래처로"}
          </Button>
          <Button size="xs" variant="ghost" onClick={onEdit}>
            <PencilIcon className="size-3" />
            수정
          </Button>
          <Button size="xs" variant="ghost" onClick={onDelete}>
            <Trash2Icon className="size-3 text-destructive" />
            삭제
          </Button>
        </div>
      </div>
    </div>
  );
}

function TableView({ rows, onEdit, onDelete, onSalesLog, onPartner }: ActionProps) {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">사진</TableHead>
            <TableHead>이름 / 회사</TableHead>
            <TableHead className="w-36">연락처</TableHead>
            <TableHead>거래처 매핑</TableHead>
            <TableHead className="w-24 text-center">영업</TableHead>
            <TableHead className="w-28">수집일</TableHead>
            <TableHead className="w-44 text-right">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="size-10 overflow-hidden rounded border bg-muted">
                  {r.thumbnail_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={r.thumbnail_url} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <CreditCardIcon className="size-4 opacity-30" />
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  {r.title ?? ""}
                  {r.title && r.company ? " / " : ""}
                  {r.company ?? ""}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.phone ? <div>{r.phone}</div> : null}
                {r.email ? <div className="truncate">{r.email}</div> : null}
                {!r.phone && !r.email ? "—" : null}
              </TableCell>
              <TableCell>
                {r.partner ? (
                  <span className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground mr-1">[{r.partner.code}]</span>
                    {r.partner.name}
                  </span>
                ) : (
                  <Badge tone="amber">잠재</Badge>
                )}
              </TableCell>
              <TableCell className="text-center">
                {r.sales_count > 0 ? (
                  <span className="text-sm">{r.sales_count}건</span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">{r.collected_on ?? "—"}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="xs" variant="outline" onClick={() => onSalesLog(r)}>
                    영업
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onPartner(r)}
                    disabled={!!r.partner_id}
                  >
                    거래처
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => onEdit(r)} aria-label="수정">
                    <PencilIcon />
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => onDelete(r)} aria-label="삭제">
                    <Trash2Icon className="text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Badge({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode;
  tone: "emerald" | "amber" | "blue";
  icon?: React.ReactNode;
}) {
  const cls = {
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  }[tone];
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs ${cls}`}>
      {icon}
      {children}
    </span>
  );
}
