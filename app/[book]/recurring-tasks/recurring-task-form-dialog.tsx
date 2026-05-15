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
import { BOOKS, BOOK_LABEL } from "@/lib/book";
import {
  createRecurringTask,
  updateRecurringTask,
  type RecurringTaskActionResult,
} from "./actions";

export type RecurringTaskRow = {
  id: string;
  title: string;
  cadence: string;
  due_rule: string | null;
  related_book: string | null;
  notes: string | null;
  next_due_date: string | null;
  is_active: boolean;
};

export const CADENCE_OPTIONS = [
  { value: "daily", label: "매일" },
  { value: "weekly", label: "매주" },
  { value: "monthly", label: "매월" },
  { value: "yearly", label: "매년" },
  { value: "adhoc", label: "비정기" },
] as const;

export const CADENCE_LABEL: Record<string, string> = Object.fromEntries(
  CADENCE_OPTIONS.map((c) => [c.value, c.label]),
);

export function RecurringTaskFormDialog({
  open,
  onOpenChange,
  editing,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: RecurringTaskRow | null;
  /** 신규 생성 시 캘린더에서 클릭한 날짜 prefill */
  defaultDate?: string | null;
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
      const result: RecurringTaskActionResult = editing
        ? await updateRecurringTask(editing.id, formData)
        : await createRecurringTask(formData);

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
          <DialogTitle>{editing ? "정기업무 수정" : "신규 정기업무"}</DialogTitle>
          <DialogDescription>
            반복 주기와 다음 실행 예정일을 설정하세요. 완료 체크 시 주기에 따라 자동 갱신됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          action={handleSubmit}
          className="flex flex-col gap-3"
          key={editing?.id ?? defaultDate ?? "new"}
        >
          <Field
            label="제목 *"
            name="title"
            defaultValue={editing?.title}
            placeholder="부가세 신고 / 통장 잔고 확인 / ..."
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">반복 주기</span>
              <select
                name="cadence"
                defaultValue={editing?.cadence ?? "monthly"}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                {CADENCE_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="다음 실행 예정일"
              name="next_due_date"
              type="date"
              defaultValue={editing?.next_due_date ?? defaultDate ?? undefined}
            />
          </div>

          <Field
            label="규칙 설명"
            name="due_rule"
            defaultValue={editing?.due_rule ?? undefined}
            placeholder="매월 10일 / 분기 첫 영업일 등"
          />

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">관련 책 (선택)</span>
            <select
              name="related_book"
              defaultValue={editing?.related_book ?? ""}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">— 전체</option>
              {BOOKS.map((b) => (
                <option key={b} value={b}>
                  {BOOK_LABEL[b]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">메모</span>
            <textarea
              name="notes"
              defaultValue={editing?.notes ?? ""}
              rows={2}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={editing ? editing.is_active : true}
              className="size-4"
            />
            활성 상태
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
