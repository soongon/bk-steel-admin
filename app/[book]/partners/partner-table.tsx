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
import { PartnerFormDialog, type PartnerRow, type PartnerPrefill } from "./partner-form-dialog";
import { deletePartner } from "./actions";

export function PartnerTable({
  partners,
  prefill,
}: {
  partners: PartnerRow[];
  prefill?: PartnerPrefill | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(!!prefill);
  const [editing, setEditing] = useState<PartnerRow | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (prefill?.from_card_id) {
      setEditing(null);
      setOpen(true);
    }
  }, [prefill?.from_card_id]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && prefill) {
      router.replace(pathname);
    }
  }

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(p: PartnerRow) {
    setEditing(p);
    setOpen(true);
  }
  function handleDelete(p: PartnerRow) {
    if (!window.confirm(`거래처 [${p.name}]를 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await deletePartner(p.id);
      if (result.ok) toast.success("삭제되었습니다");
      else toast.error(result.error);
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          총 <span className="font-medium text-foreground">{partners.length}</span>건
        </p>
        <Button onClick={openCreate} size="sm">
          <PlusIcon className="size-4" />
          신규 거래처
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">코드</TableHead>
              <TableHead>거래처명</TableHead>
              <TableHead className="w-24">대표자</TableHead>
              <TableHead className="w-36">연락처</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead className="w-28">업종</TableHead>
              <TableHead className="w-16 text-center">활성</TableHead>
              <TableHead className="w-20 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  등록된 거래처가 없습니다. <button onClick={openCreate} className="underline">신규 추가</button>
                </TableCell>
              </TableRow>
            ) : (
              partners.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.representative ?? "—"}</TableCell>
                  <TableCell>{p.phone ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {p.email ?? "—"}
                  </TableCell>
                  <TableCell>{p.industry ?? "—"}</TableCell>
                  <TableCell className="text-center">
                    {p.is_active ? (
                      <span className="inline-flex h-5 items-center rounded-full bg-emerald-100 px-2 text-xs text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                        활성
                      </span>
                    ) : (
                      <span className="inline-flex h-5 items-center rounded-full bg-zinc-100 px-2 text-xs text-zinc-600 dark:bg-zinc-800/50">
                        비활성
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-xs" variant="ghost" onClick={() => openEdit(p)} aria-label="수정">
                        <PencilIcon />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => handleDelete(p)} aria-label="삭제">
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

      <PartnerFormDialog
        open={open}
        onOpenChange={handleOpenChange}
        editing={editing}
        prefill={editing ? null : prefill}
      />
    </>
  );
}
