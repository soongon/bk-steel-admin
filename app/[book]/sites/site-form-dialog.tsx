"use client";

import { useEffect, useState, useTransition } from "react";
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
import { createSite, updateSite, type SiteActionResult } from "./actions";

export type SiteRow = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  client_name: string | null;
  owner_name: string | null;
  owner_address: string | null;
  status: "active" | "closed";
  started_on: string | null;
  ended_on: string | null;
  notes: string | null;
  is_active: boolean;
};

export function SiteFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SiteRow | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: SiteActionResult = editing
        ? await updateSite(editing.id, formData)
        : await createSite(formData);

      if (result.ok) {
        toast.success(editing ? "현장이 수정되었습니다" : "현장이 추가되었습니다");
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "현장 수정" : "신규 현장 등록"}</DialogTitle>
          <DialogDescription>
            공유 마스터 — 매출·납품확인서에서 현장 식별의 기준이 됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          action={handleSubmit}
          className="flex flex-col gap-3"
          key={editing?.id ?? "new"}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={editing ? "코드 *" : "코드"}
              name="code"
              defaultValue={editing?.code}
              placeholder={editing ? "예: S-0010" : "비워두면 자동 (S-NNNN)"}
              required={!!editing}
              uppercase
            />
            <Field
              label="현장명 *"
              name="name"
              defaultValue={editing?.name}
              placeholder="강남현장A"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="지역"
              name="city"
              defaultValue={editing?.city ?? undefined}
              placeholder="서울 강남구"
            />
            <Field
              label="시공사"
              name="client_name"
              defaultValue={editing?.client_name ?? undefined}
              placeholder="(주)○○건설"
            />
          </div>
          <Field
            label="현장 주소"
            name="address"
            defaultValue={editing?.address ?? undefined}
          />

          {/* 건축주 (관급이면 사업명) — 납품확인서 필수 */}
          <div className="rounded-md border-dashed border-2 border-zinc-300 p-3 dark:border-zinc-700">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              건축주 / 발주청 (관급이면 사업명) — 납품확인서 표기 필수
            </p>
            <div className="grid grid-cols-1 gap-3">
              <Field
                label="건축주·사업명"
                name="owner_name"
                defaultValue={editing?.owner_name ?? undefined}
                placeholder="○○구청 / 관급사업명 / 개인 건축주"
              />
              <Field
                label="건축주 주소"
                name="owner_address"
                defaultValue={editing?.owner_address ?? undefined}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="착공일"
              name="started_on"
              type="date"
              defaultValue={editing?.started_on ?? undefined}
            />
            <Field
              label="준공일"
              name="ended_on"
              type="date"
              defaultValue={editing?.ended_on ?? undefined}
            />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">상태</span>
            <select
              name="status"
              defaultValue={editing?.status ?? "active"}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="active">진행</option>
              <option value="closed">완료</option>
            </select>
          </label>
          <Field
            label="메모"
            name="notes"
            defaultValue={editing?.notes ?? undefined}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={editing ? editing.is_active : true}
              className="size-4"
            />
            활성 상태 (콤보 표시)
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
  uppercase,
  type,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  uppercase?: boolean;
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
        style={uppercase ? { textTransform: "uppercase" } : undefined}
      />
    </label>
  );
}
