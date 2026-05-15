"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createIdea, updateIdea, type IdeaActionResult } from "./actions";

export type IdeaRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  priority: string | null;
  proposed_at: string;
  resolved_at: string | null;
  notes: string | null;
};

export const STATUS_OPTIONS = [
  { value: "open", label: "대기" },
  { value: "in_progress", label: "진행 중" },
  { value: "done", label: "완료" },
] as const;
export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((s) => [s.value, s.label]),
);

export const CATEGORY_OPTIONS = [
  { value: "system", label: "시스템" },
  { value: "process", label: "프로세스" },
  { value: "sales", label: "영업" },
  { value: "operations", label: "운영" },
] as const;
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((c) => [c.value, c.label]),
);

export const PRIORITY_OPTIONS = [
  { value: "high", label: "높음" },
  { value: "medium", label: "보통" },
  { value: "low", label: "낮음" },
] as const;
export const PRIORITY_LABEL: Record<string, string> = Object.fromEntries(
  PRIORITY_OPTIONS.map((p) => [p.value, p.label]),
);

export function IdeaFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: IdeaRow | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: IdeaActionResult = editing
        ? await updateIdea(editing.id, formData)
        : await createIdea(formData);

      if (result.ok) {
        toast.success(editing ? "수정되었습니다" : "추가되었습니다");
        onOpenChange(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "아이디어 수정" : "신규 아이디어"}</DialogTitle>
          <DialogDescription>
            업무 개선 / 시스템 / 영업 등 자유롭게 적어두고 처리해 나가세요.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="flex flex-col gap-3" key={editing?.id ?? "new"}>
          <Field
            label="제목 *"
            name="title"
            defaultValue={editing?.title}
            placeholder="간단한 한 줄 — 자세한 건 아래 설명에"
            required
          />

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">설명</span>
            <textarea
              name="description"
              defaultValue={editing?.description ?? ""}
              rows={3}
              placeholder="배경 / 기대효과 / 구현 아이디어 등"
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <SelectField
              label="상태"
              name="status"
              defaultValue={editing?.status ?? "open"}
              options={STATUS_OPTIONS}
            />
            <SelectField
              label="카테고리"
              name="category"
              defaultValue={editing?.category ?? ""}
              options={CATEGORY_OPTIONS}
              includeEmpty
            />
            <SelectField
              label="우선순위"
              name="priority"
              defaultValue={editing?.priority ?? ""}
              options={PRIORITY_OPTIONS}
              includeEmpty
            />
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">메모</span>
            <textarea
              name="notes"
              defaultValue={editing?.notes ?? ""}
              rows={2}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중..." : editing ? "수정" : "추가"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  type,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
  includeEmpty,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: readonly { value: string; label: string }[];
  includeEmpty?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="h-9 rounded-md border bg-background px-3 text-sm"
      >
        {includeEmpty ? <option value="">—</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
