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
import { createPartner, updatePartner, type PartnerActionResult } from "./actions";

export type PartnerRow = {
  id: string;
  code: string;
  name: string;
  business_no: string | null;
  representative: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  industry: string | null;
  notes: string | null;
  is_active: boolean;
};

export function PartnerFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PartnerRow | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: PartnerActionResult = editing
        ? await updatePartner(editing.id, formData)
        : await createPartner(formData);

      if (result.ok) {
        toast.success(editing ? "거래처가 수정되었습니다" : "거래처가 추가되었습니다");
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
          <DialogTitle>{editing ? "거래처 수정" : "신규 거래처 등록"}</DialogTitle>
          <DialogDescription>
            공유 마스터 — 매출·매입에서 거래처명 정합성의 기준이 됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          action={handleSubmit}
          className="flex flex-col gap-3"
          // key로 dialog 새로 열릴 때마다 form state 리셋
          key={editing?.id ?? "new"}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="코드 *" name="code" defaultValue={editing?.code} placeholder="예: P-100" required uppercase />
            <Field label="거래처명 *" name="name" defaultValue={editing?.name} placeholder="(주)엠에스스틸" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="대표자" name="representative" defaultValue={editing?.representative ?? undefined} />
            <Field label="사업자번호" name="business_no" defaultValue={editing?.business_no ?? undefined} placeholder="000-00-00000" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="연락처" name="phone" defaultValue={editing?.phone ?? undefined} placeholder="010-0000-0000" />
            <Field label="이메일" name="email" type="email" defaultValue={editing?.email ?? undefined} placeholder="contact@partner.com" />
          </div>
          <Field label="업종" name="industry" defaultValue={editing?.industry ?? undefined} placeholder="철근 대리점" />
          <Field label="주소" name="address" defaultValue={editing?.address ?? undefined} />
          <Field label="메모" name="notes" defaultValue={editing?.notes ?? undefined} />

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
