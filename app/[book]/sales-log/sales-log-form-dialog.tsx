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
import {
  createSalesLog,
  updateSalesLog,
  type SalesLogActionResult,
} from "./actions";

export type PartnerOption = { id: string; code: string; name: string };

export type SalesLogRow = {
  id: string;
  contacted_on: string;
  partner_id: string | null;
  prospect_name: string | null;
  contact_person: string | null;
  channel: string | null;
  result: string | null;
  follow_up_on: string | null;
  notes: string | null;
};

/**
 * 명함에서 영업내역으로 prefill 이관할 때 쓰는 시드 데이터.
 * id/follow_up_on 등 명함에 없는 항목은 SalesLogRow에서 빠져있음.
 */
export type SalesLogPrefill = {
  contacted_on?: string;
  partner_id?: string | null;
  prospect_name?: string | null;
  contact_person?: string | null;
  channel?: string | null;
  notes?: string | null;
  business_card_id: string;
};

const CHANNELS = [
  { value: "phone", label: "전화" },
  { value: "visit", label: "방문" },
  { value: "email", label: "이메일" },
  { value: "sms", label: "문자/카톡" },
] as const;

export function SalesLogFormDialog({
  open,
  onOpenChange,
  editing,
  partners,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SalesLogRow | null;
  partners: PartnerOption[];
  prefill?: SalesLogPrefill | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: SalesLogActionResult = editing
        ? await updateSalesLog(editing.id, formData)
        : await createSalesLog(formData);

      if (result.ok) {
        toast.success(editing ? "영업내역이 수정되었습니다" : "영업내역이 추가되었습니다");
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  // editing > prefill > 빈값 우선순위
  const initial = editing ?? prefill ?? null;
  const isPrefill = !editing && !!prefill;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "영업내역 수정" : isPrefill ? "신규 영업내역 (명함 기반)" : "신규 영업내역"}
          </DialogTitle>
          <DialogDescription>
            {isPrefill
              ? "명함 정보로 채워진 폼입니다. 검토 후 보강하세요."
              : "등록 거래처에서 선택하거나, 미등록 잠재 거래처명을 직접 입력하세요."}
          </DialogDescription>
        </DialogHeader>

        <form
          action={handleSubmit}
          className="flex flex-col gap-3"
          key={editing?.id ?? prefill?.business_card_id ?? "new"}
        >
          {prefill?.business_card_id ? (
            <input type="hidden" name="business_card_id" value={prefill.business_card_id} />
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="접촉일 *"
              name="contacted_on"
              type="date"
              defaultValue={initial?.contacted_on ?? today}
              required
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">채널</span>
              <select
                name="channel"
                defaultValue={initial?.channel ?? ""}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">—</option>
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">등록 거래처</span>
            <select
              name="partner_id"
              defaultValue={initial?.partner_id ?? ""}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">— 미등록 (아래 잠재 거래처명 입력)</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.code}] {p.name}
                </option>
              ))}
            </select>
          </label>

          <Field
            label="잠재 거래처명"
            name="prospect_name"
            defaultValue={initial?.prospect_name ?? undefined}
            placeholder="등록 안 된 잠재 거래처일 때 입력"
          />

          <Field
            label="담당자"
            name="contact_person"
            defaultValue={initial?.contact_person ?? undefined}
            placeholder="홍길동 과장"
          />

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">결과</span>
            <textarea
              name="result"
              defaultValue={editing?.result ?? ""}
              rows={2}
              placeholder="견적 요청 / 거절 / 보류 등"
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>

          <Field
            label="후속 조치 일자"
            name="follow_up_on"
            type="date"
            defaultValue={editing?.follow_up_on ?? undefined}
          />

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">메모</span>
            <textarea
              name="notes"
              defaultValue={initial?.notes ?? ""}
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

export const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(
  CHANNELS.map((c) => [c.value, c.label]),
);
