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
import {
  AttachmentUploader,
} from "@/components/admin/attachments/attachment-uploader";
import { AttachmentGallery } from "@/components/admin/attachments/attachment-gallery";
import { type Attachment } from "@/lib/attachment";
import { formatPhone } from "@/lib/format";
import {
  createBusinessCard,
  updateBusinessCard,
  type BusinessCardActionResult,
} from "./actions";

export type PartnerOption = { id: string; code: string; name: string };

export type BusinessCardRow = {
  id: string;
  collected_on: string | null;
  partner_id: string | null;
  name: string;
  title: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

export function BusinessCardFormDialog({
  open,
  onOpenChange,
  editing,
  partners,
  attachments: initialAttachments = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: BusinessCardRow | null;
  partners: PartnerOption[];
  attachments?: Attachment[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);

  useEffect(() => {
    if (open) {
      setError(null);
      setAttachments(initialAttachments);
    }
  }, [open, initialAttachments]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: BusinessCardActionResult = editing
        ? await updateBusinessCard(editing.id, formData)
        : await createBusinessCard(formData);

      if (result.ok) {
        toast.success(editing ? "명함이 수정되었습니다" : "명함이 추가되었습니다");
        onOpenChange(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "명함 수정" : "신규 명함"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "정보를 수정하거나 사진(앞/뒷면)을 추가할 수 있습니다."
              : "기본 정보 저장 후 사진을 첨부할 수 있습니다."}
          </DialogDescription>
        </DialogHeader>

        <form
          action={handleSubmit}
          className="flex flex-col gap-3"
          key={editing?.id ?? "new"}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="이름 *" name="name" defaultValue={editing?.name} required placeholder="홍길동" />
            <Field label="직책" name="title" defaultValue={editing?.title ?? undefined} placeholder="영업이사" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="회사" name="company" defaultValue={editing?.company ?? undefined} placeholder="(주)ABC" />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">등록 거래처 매핑</span>
              <select
                name="partner_id"
                defaultValue={editing?.partner_id ?? ""}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">— 미매핑 (잠재)</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.code}] {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="연락처" name="phone" defaultValue={formatPhone(editing?.phone)} placeholder="010-0000-0000" />
            <Field label="이메일" name="email" type="email" defaultValue={editing?.email ?? undefined} />
          </div>
          <Field label="주소" name="address" defaultValue={editing?.address ?? undefined} />
          <Field
            label="수집일"
            name="collected_on"
            type="date"
            defaultValue={editing?.collected_on ?? new Date().toISOString().slice(0, 10)}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">메모</span>
            <textarea
              name="notes"
              defaultValue={editing?.notes ?? ""}
              rows={2}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>

          {/* 사진 — 편집 모드에서만. 신규는 저장 후 편집 모드 진입 */}
          {editing ? (
            <div className="rounded-md border-dashed border-2 border-zinc-300 p-3 dark:border-zinc-700">
              <p className="mb-2 text-xs font-medium text-muted-foreground">사진 (앞면 · 뒷면)</p>
              <div className="flex flex-col gap-3">
                <AttachmentGallery
                  attachments={attachments}
                  variant="card"
                  editable
                  onDeleted={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
                  emptyLabel="사진 없음 — 아래에서 추가"
                />
                <AttachmentUploader
                  entityType="business_card"
                  entityId={editing.id}
                  multiple
                  label="사진 추가 (앞/뒷면)"
                  onUploaded={(att) => setAttachments((prev) => [...prev, att])}
                />
              </div>
            </div>
          ) : (
            <p className="rounded-md border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
              사진은 명함 저장 후 첨부할 수 있습니다.
            </p>
          )}

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
