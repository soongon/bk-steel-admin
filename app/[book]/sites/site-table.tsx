"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
import { SiteFormDialog, type SiteRow } from "./site-form-dialog";
import { deleteSite } from "./actions";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  active: {
    label: "진행",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  closed: {
    label: "완료",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400",
  },
};

export function SiteTable({ sites }: { sites: SiteRow[] }) {
  const params = useParams<{ book: string }>();
  const book = params.book ?? "all";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(s: SiteRow) {
    setEditing(s);
    setOpen(true);
  }
  function handleDelete(s: SiteRow) {
    if (!window.confirm(`현장 [${s.name}]을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await deleteSite(s.id);
      if (r.ok) toast.success("삭제되었습니다");
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          총 <span className="font-medium text-foreground">{sites.length}</span>건
        </p>
        <Button onClick={openCreate} size="sm">
          <PlusIcon className="size-4" />
          신규 현장
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">코드</TableHead>
              <TableHead>현장명</TableHead>
              <TableHead className="w-32">지역</TableHead>
              <TableHead>주소</TableHead>
              <TableHead className="w-44">시공사 / 건축주</TableHead>
              <TableHead className="w-32">기간</TableHead>
              <TableHead className="w-20 text-center">상태</TableHead>
              <TableHead className="w-20 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  등록된 현장이 없습니다.{" "}
                  <button onClick={openCreate} className="underline">
                    신규 추가
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              sites.map((s) => {
                const st = STATUS_LABEL[s.status] ?? STATUS_LABEL.active;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/${book}/sites/${s.id}`} className="hover:underline">
                        {s.code}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/${book}/sites/${s.id}`} className="hover:underline">
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{s.city ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.address ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.client_name ? (
                        <div className="text-xs text-muted-foreground">
                          시공 {s.client_name}
                        </div>
                      ) : null}
                      <div>{s.owner_name ?? (s.client_name ? null : "—")}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.started_on ?? "—"}
                      {s.ended_on ? ` ~ ${s.ended_on}` : ""}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${st.className}`}
                      >
                        {st.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => openEdit(s)}
                          aria-label="수정"
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => handleDelete(s)}
                          aria-label="삭제"
                        >
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

      <SiteFormDialog open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
