"use client";

import { useState, useTransition } from "react";
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
  DISMISS_REASONS,
  PERMANENT_DISMISS_REASON,
  RESULT_CODES,
  defaultFollowUp,
  resultCodeOf,
} from "@/lib/radar/v2-rules";
import { cn } from "@/lib/utils";
import { dismissRadarProject, recordRadarTouch, type RadarActionResult } from "./actions";

export interface TouchTarget {
  id: string;
  label: string; // 주소 또는 낙찰사명
  channel: "visit" | "phone";
}

/**
 * [기록] 다이얼로그 — 결과 코드 4종(고정) + 담당자·전화·업체·메모·다음 행동일.
 * 제출 = RPC radar_touch(sales_log INSERT + 제외 코드면 dismissed_at) 한 트랜잭션.
 */
export function TouchDialog({
  target,
  today,
  onOpenChange,
}: {
  target: TouchTarget | null;
  today: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 기본 '다음에'. 대상이 바뀌면 radar-v2.tsx 가 key 로 인스턴스를 새로 만들어 상태가 초기화된다(effect 불필요).
  const [result, setResult] = useState<string>(RESULT_CODES[1].code);
  const [followUp, setFollowUp] = useState<string>(defaultFollowUp(RESULT_CODES[1].code, today) ?? "");

  const code = resultCodeOf(result);
  const isDismiss = code?.followUpDays == null;

  // <form action>은 React 19가 제출 후 비제어 입력을 초기화한다 → 서버 오류 때 담당자·전화·메모가 사라짐.
  // onSubmit 으로 FormData 를 직접 넘겨 실패해도 입력이 남게 한다.
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    handleSubmit(new FormData(e.currentTarget));
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r: RadarActionResult = await recordRadarTouch(formData);
      if (r.ok) {
        toast.success(isDismiss ? "기록 후 완료로 이동했습니다" : "기록했습니다");
        onOpenChange(false);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{target?.channel === "phone" ? "통화 기록" : "방문 기록"}</DialogTitle>
          <DialogDescription className="truncate">{target?.label}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3" key={target?.id ?? "none"}>
          <input type="hidden" name="project_id" value={target?.id ?? ""} />
          <input type="hidden" name="channel" value={target?.channel ?? "visit"} />

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm text-muted-foreground">결과 *</legend>
            <div className="grid grid-cols-2 gap-2">
              {RESULT_CODES.map((rc) => (
                <label
                  key={rc.code}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 rounded-lg border p-2.5 text-sm",
                    result === rc.code ? "border-foreground/40 bg-muted ring-1 ring-foreground/10" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="result"
                      value={rc.code}
                      checked={result === rc.code}
                      onChange={() => {
                        setResult(rc.code);
                        setFollowUp(defaultFollowUp(rc.code, today) ?? "");
                      }}
                    />
                    {rc.code}
                  </span>
                  <span className="pl-5 text-[11px] text-muted-foreground">{rc.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Field label="접촉일" name="contacted_on" type="date" defaultValue={today} required />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">다음 행동일{isDismiss ? " (제외 — 없음)" : ""}</span>
              <Input
                name="follow_up_on"
                type="date"
                value={isDismiss ? "" : followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                disabled={isDismiss}
                required={!isDismiss}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="담당자" name="contact_person" placeholder="현장소장 김○○" />
            <Field label="담당자 전화" name="contact_phone" type="tel" placeholder="010-0000-0000" />
          </div>
          {target?.channel === "visit" ? (
            <Field label="시공사·업체명 (표지판)" name="company" placeholder="○○종합건설" />
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">메모</span>
            <textarea name="notes" rows={2} className="rounded-md border bg-background px-3 py-2 text-sm" />
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중..." : isDismiss ? "기록하고 완료" : "기록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** [제외] 다이얼로그 — 사유 3종. '철근 안 씀·거절'은 복구 불가(수신거부 보장). */
export function DismissDialog({
  target,
  onOpenChange,
}: {
  target: TouchTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  // 대상이 바뀌면 key 로 재마운트(radar-v2.tsx) — effect 로 초기화하지 않는다.
  const [reason, setReason] = useState<string>(DISMISS_REASONS[1]);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!target) return;
    startTransition(async () => {
      const r = await dismissRadarProject(target.id, reason);
      if (r.ok) {
        toast.success("완료로 이동했습니다");
        onOpenChange(false);
      } else setError(r.error);
    });
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>제외</DialogTitle>
          <DialogDescription className="truncate">{target?.label}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {DISMISS_REASONS.map((r) => (
            <label
              key={r}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm",
                reason === r ? "border-foreground/40 bg-muted ring-1 ring-foreground/10" : "hover:bg-muted/50",
              )}
            >
              <input type="radio" name="dismiss_reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span className="font-medium">{r}</span>
              {r === PERMANENT_DISMISS_REASON ? (
                <span className="ml-auto text-[11px] text-muted-foreground">복구 없음</span>
              ) : null}
            </label>
          ))}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "처리 중..." : "제외"}
          </Button>
        </DialogFooter>
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
      <Input name={name} type={type} defaultValue={defaultValue ?? ""} placeholder={placeholder} required={required} />
    </label>
  );
}
