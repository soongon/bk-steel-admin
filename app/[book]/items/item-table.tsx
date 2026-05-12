"use client";

import { useMemo, useState, useTransition } from "react";
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
  ItemFormDialog,
  type ItemRow,
  type RebarSpecOption,
  type RebarGradeOption,
} from "./item-form-dialog";
import { deleteItem } from "./actions";
import { type ItemCategory } from "./actions";

const CATEGORY_LABEL: Record<ItemCategory, { label: string; className: string }> = {
  rebar: {
    label: "철근",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  },
  hbeam: {
    label: "H빔",
    className: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
  },
  pipe: {
    label: "각파이프",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  scrap: {
    label: "고철",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  },
  etc: {
    label: "기타",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300",
  },
};

const CATEGORY_FILTER: { value: "all" | ItemCategory; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "rebar", label: "철근" },
  { value: "hbeam", label: "H빔" },
  { value: "pipe", label: "각파이프" },
  { value: "scrap", label: "고철" },
  { value: "etc", label: "기타" },
];

export function ItemTable({
  items,
  specs,
  grades,
}: {
  items: ItemRow[];
  specs: RebarSpecOption[];
  grades: RebarGradeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [filter, setFilter] = useState<"all" | ItemCategory>("all");
  const [, startTransition] = useTransition();

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.category === filter)),
    [items, filter],
  );

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(i: ItemRow) {
    setEditing(i);
    setOpen(true);
  }
  function handleDelete(i: ItemRow) {
    if (!window.confirm(`품목 [${i.name}]을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await deleteItem(i.id);
      if (r.ok) toast.success("삭제되었습니다");
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            총 <span className="font-medium text-foreground">{visible.length}</span>건
            {filter !== "all" ? ` (전체 ${items.length})` : ""}
          </p>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="h-7 rounded-md border bg-background px-2 text-xs"
          >
            {CATEGORY_FILTER.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={openCreate} size="sm">
          <PlusIcon className="size-4" />
          신규 품목
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20 text-center">카테고리</TableHead>
              <TableHead className="w-44">코드</TableHead>
              <TableHead>품목명</TableHead>
              <TableHead className="w-44">규격</TableHead>
              <TableHead className="w-24 text-right">단위중량(kg)</TableHead>
              <TableHead className="w-16 text-center">활성</TableHead>
              <TableHead className="w-20 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  등록된 품목이 없습니다.{" "}
                  <button onClick={openCreate} className="underline">
                    신규 추가
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              visible.map((i) => {
                const cat = CATEGORY_LABEL[i.category];
                const spec =
                  i.category === "rebar"
                    ? `${i.rebar_spec_code ?? ""} ${i.rebar_grade_code ?? ""}${
                        i.length_m ? ` ${i.length_m}M` : ""
                      }`.trim()
                    : (i.spec_text ?? "—");
                return (
                  <TableRow key={i.id}>
                    <TableCell className="text-center">
                      <span
                        className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${cat.className}`}
                      >
                        {cat.label}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{i.code}</TableCell>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell className="text-sm">{spec || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {i.weight_per_unit_kg != null
                        ? Number(i.weight_per_unit_kg).toLocaleString("ko-KR", {
                            maximumFractionDigits: 3,
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {i.is_active ? (
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
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => openEdit(i)}
                          aria-label="수정"
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => handleDelete(i)}
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

      <ItemFormDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        specs={specs}
        grades={grades}
      />
    </>
  );
}
