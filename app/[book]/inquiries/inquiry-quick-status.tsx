"use client";

import { useOptimistic, useTransition } from "react";
import { CheckIcon, Loader2Icon, PlayIcon } from "lucide-react";
import { toast } from "sonner";
import { type InquiryStatus, inquiryStatusMeta } from "@/lib/inquiry";
import { cn } from "@/lib/utils";
import { updateInquiryStatus } from "./actions";

/**
 * 목록 한 줄에서 바로 다음 상태로 — 새 문의 → [진행 시작], 진행중 → [완료].
 * 저장(홈페이지 DB)·목록 다시 그리기가 몇 초 걸려 누르는 즉시 바뀐 모양으로 보이고, 실패하면 되돌아온다.
 * 행 클릭(상세 이동)은 InquiryRow 가 button 을 걸러 막는다.
 */
export function InquiryQuickStatus({ id, to }: { id: string; to: Extract<InquiryStatus, "read" | "resolved"> }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useOptimistic(false);
  const meta = inquiryStatusMeta(to);

  function handle() {
    startTransition(async () => {
      setDone(true);
      const r = await updateInquiryStatus(id, to);
      if (r.ok) toast.success(`상태: ${meta.label}`);
      else toast.error(r.error);
    });
  }

  const start = to === "read";
  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs sm:gap-1.5 sm:px-3 font-semibold whitespace-nowrap transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
        done
          ? meta.solid
          : start
            ? "bg-sky-600 text-white shadow-sm shadow-sky-600/30 hover:bg-sky-700 dark:bg-sky-500"
            : "border border-emerald-600/30 bg-background text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
      )}
    >
      {pending ? <Loader2Icon className="size-3.5 animate-spin" /> : start && !done ? <PlayIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
      {done ? meta.label : start ? "진행 시작" : "완료"}
    </button>
  );
}
