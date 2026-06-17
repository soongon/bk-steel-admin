"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
  SalesLogFormDialog,
  CHANNEL_LABEL,
  type SalesLogRow,
  type SalesLogPrefill,
  type PartnerOption,
} from "./sales-log-form-dialog";
import { QuoteButton, type QuoteSources } from "@/components/admin/quote-dialog";
import { deleteSalesLog } from "./actions";

type Row = SalesLogRow & {
  partner: { code: string; name: string } | null;
};

export function SalesLogTable({
  rows,
  partners,
  prefill,
  quoteSources,
}: {
  rows: Row[];
  partners: PartnerOption[];
  prefill?: SalesLogPrefill | null;
  quoteSources: QuoteSources;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(!!prefill);
  const [editing, setEditing] = useState<SalesLogRow | null>(null);
  const [, startTransition] = useTransition();

  // prefill이 (다른 명함으로) 바뀔 때마다 다이얼로그 자동 오픈
  useEffect(() => {
    if (prefill?.business_card_id) {
      setEditing(null);
      setOpen(true);
    }
  }, [prefill?.business_card_id]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // prefill 모드에서 닫을 때 URL의 ?from_card 제거 — 재오픈 방지
    if (!next && prefill) {
      router.replace(pathname);
    }
  }

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setOpen(true);
  }
  function handleDelete(r: Row) {
    const label = r.partner?.name ?? r.prospect_name ?? "(이름 없음)";
    if (!window.confirm(`[${r.contacted_on}] ${label} 영업내역을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await deleteSalesLog(r.id);
      if (result.ok) toast.success("삭제되었습니다");
      else toast.error(result.error);
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  function followUpBadge(date: string | null) {
    if (!date) return null;
    if (date < today) {
      return (
        <span className="inline-flex h-5 items-center rounded-full bg-rose-100 px-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          지남
        </span>
      );
    }
    const diff = (new Date(date).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
    if (diff <= 7) {
      return (
        <span className="inline-flex h-5 items-center rounded-full bg-amber-100 px-2 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
          임박
        </span>
      );
    }
    return null;
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          총 <span className="font-medium text-foreground">{rows.length}</span>건
        </p>
        <Button onClick={openCreate} size="sm">
          <PlusIcon className="size-4" />
          신규 영업내역
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">접촉일</TableHead>
              <TableHead>거래처 / 잠재명</TableHead>
              <TableHead className="w-28">담당자</TableHead>
              <TableHead className="w-20">채널</TableHead>
              <TableHead>결과</TableHead>
              <TableHead className="w-32">후속 조치</TableHead>
              <TableHead className="w-36 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  등록된 영업내역이 없습니다.{" "}
                  <button onClick={openCreate} className="underline">
                    신규 추가
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.contacted_on}</TableCell>
                  <TableCell>
                    {r.partner ? (
                      <span className="font-medium">
                        <span className="text-muted-foreground text-xs font-mono mr-1">
                          [{r.partner.code}]
                        </span>
                        {r.partner.name}
                      </span>
                    ) : (
                      <span className="font-medium text-muted-foreground italic">
                        {r.prospect_name ?? "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{r.contact_person ?? "—"}</TableCell>
                  <TableCell>{r.channel ? CHANNEL_LABEL[r.channel] ?? r.channel : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground line-clamp-2">
                    {r.result ?? "—"}
                  </TableCell>
                  <TableCell>
                    {r.follow_up_on ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{r.follow_up_on}</span>
                        {followUpBadge(r.follow_up_on)}
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <QuoteButton
                        sources={quoteSources}
                        book="all"
                        defaultPartnerName={r.partner?.name ?? r.prospect_name ?? ""}
                        label="견적"
                        variant="outline"
                      />
                      <Button size="icon-xs" variant="ghost" onClick={() => openEdit(r)} aria-label="수정">
                        <PencilIcon />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => handleDelete(r)} aria-label="삭제">
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <SalesLogFormDialog
        open={open}
        onOpenChange={handleOpenChange}
        editing={editing}
        partners={partners}
        prefill={editing ? null : prefill}
      />
    </>
  );
}
