"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  IdeaFormDialog,
  STATUS_OPTIONS,
  STATUS_LABEL,
  CATEGORY_OPTIONS,
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  type IdeaRow,
} from "./idea-form-dialog";
import { deleteIdea, setIdeaStatus } from "./actions";

const STATUS_ORDER: Record<string, number> = { open: 0, in_progress: 1, done: 2 };
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

const PRIORITY_DOT_CLASS: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-zinc-400",
};

const CATEGORY_TONE: Record<string, string> = {
  system: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  process: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
  sales: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  operations: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
};

export function IdeaList({ ideas }: { ideas: IdeaRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IdeaRow | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // 필터
  const [statusFilter, setStatusFilter] = useState<string>("active"); // 'active' = open+in_progress
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return ideas
      .filter((i) => {
        if (statusFilter === "active") return i.status !== "done";
        if (statusFilter === "all") return true;
        return i.status === statusFilter;
      })
      .filter((i) => (categoryFilter === "all" ? true : i.category === categoryFilter))
      .sort((a, b) => {
        const sa = STATUS_ORDER[a.status] ?? 99;
        const sb = STATUS_ORDER[b.status] ?? 99;
        if (sa !== sb) return sa - sb;
        const pa = a.priority ? (PRIORITY_ORDER[a.priority] ?? 99) : 99;
        const pb = b.priority ? (PRIORITY_ORDER[b.priority] ?? 99) : 99;
        if (pa !== pb) return pa - pb;
        return b.proposed_at.localeCompare(a.proposed_at);
      });
  }, [ideas, statusFilter, categoryFilter]);

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(i: IdeaRow) {
    setEditing(i);
    setOpen(true);
  }
  function handleDelete(i: IdeaRow) {
    if (!window.confirm(`[${i.title}] 영구 삭제하시겠습니까? (복구 불가)`)) return;
    startTransition(async () => {
      const result = await deleteIdea(i.id);
      if (result.ok) {
        toast.success("삭제되었습니다");
        router.refresh();
      } else toast.error(result.error);
    });
  }
  function handleStatusChange(i: IdeaRow, next: string) {
    if (next === i.status) return;
    startTransition(async () => {
      const result = await setIdeaStatus(i.id, next);
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });
  }
  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const counts = useMemo(() => {
    return {
      open: ideas.filter((i) => i.status === "open").length,
      in_progress: ideas.filter((i) => i.status === "in_progress").length,
      done: ideas.filter((i) => i.status === "done").length,
      total: ideas.length,
    };
  }, [ideas]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            대기 <span className="font-medium text-foreground">{counts.open}</span> / 진행 중{" "}
            <span className="font-medium text-foreground">{counts.in_progress}</span> / 완료{" "}
            <span className="font-medium text-foreground">{counts.done}</span>
          </span>
          <span className="text-muted-foreground">·</span>
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "active", label: "진행 중인 것만" },
              { value: "all", label: "전체" },
              { value: "open", label: "대기" },
              { value: "in_progress", label: "진행 중" },
              { value: "done", label: "완료" },
            ]}
          />
          <FilterSelect
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: "all", label: "전체 카테고리" },
              ...CATEGORY_OPTIONS.map((c) => ({ value: c.value, label: c.label })),
            ]}
          />
        </div>
        <Button onClick={openCreate} size="sm">
          <PlusIcon className="size-4" />
          신규 아이디어
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {ideas.length === 0 ? (
              <>
                등록된 아이디어가 없습니다.{" "}
                <button onClick={openCreate} className="underline">
                  신규 추가
                </button>
              </>
            ) : (
              "필터 조건에 해당하는 아이디어가 없습니다"
            )}
          </p>
        ) : (
          <ul className="divide-y">
            {filtered.map((i) => {
              const expanded = expandedId === i.id;
              const isDone = i.status === "done";
              return (
                <li key={i.id} className="group/idea">
                  <div className="flex items-start gap-2 px-3 py-2">
                    {/* status select */}
                    <select
                      value={i.status}
                      onChange={(e) => handleStatusChange(i, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "h-7 rounded border bg-background px-1.5 text-xs",
                        isDone && "text-muted-foreground",
                      )}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>

                    {/* expand 버튼 + 제목 */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(i.id)}
                      className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
                    >
                      {i.description || i.notes ? (
                        expanded ? (
                          <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        )
                      ) : (
                        <span className="size-3.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "font-medium",
                              isDone && "text-muted-foreground line-through",
                            )}
                          >
                            {i.title}
                          </span>
                          {i.priority ? (
                            <span
                              title={`우선순위: ${PRIORITY_LABEL[i.priority] ?? i.priority}`}
                              className={cn("size-2 rounded-full", PRIORITY_DOT_CLASS[i.priority])}
                            />
                          ) : null}
                          {i.category ? (
                            <span
                              className={cn(
                                "inline-flex h-4 items-center rounded px-1.5 text-[10px]",
                                CATEGORY_TONE[i.category] ??
                                  "bg-muted text-muted-foreground",
                              )}
                            >
                              {CATEGORY_LABEL[i.category] ?? i.category}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-muted-foreground">
                            {i.proposed_at.slice(0, 10)}
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* 액션 (호버 시) */}
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/idea:opacity-100">
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
                  </div>

                  {/* 펼침 — description / notes */}
                  {expanded && (i.description || i.notes) ? (
                    <div className="border-t bg-muted/20 px-9 py-2 text-sm">
                      {i.description ? (
                        <p className="whitespace-pre-wrap text-foreground">{i.description}</p>
                      ) : null}
                      {i.notes ? (
                        <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          📝 {i.notes}
                        </p>
                      ) : null}
                      {i.resolved_at ? (
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          완료 {i.resolved_at.slice(0, 10)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <IdeaFormDialog open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded border bg-background px-2 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
