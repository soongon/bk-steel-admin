import { inquiryStatusMeta } from "@/lib/inquiry";
import { cn } from "@/lib/utils";

/**
 * 문의 상태 배지 — 색 점 + 굵은 글씨. 진행중은 진한 파랑 바탕에 깜빡이는 점(지금 손대는 건).
 * 목록(sm)·상세 제목 옆(md) 공용. 훅이 없어 서버·클라이언트 어디서나 쓴다.
 */
export function InquiryStatusPill({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  const st = inquiryStatusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold whitespace-nowrap ring-1 ring-inset",
        size === "md" ? "h-7 gap-1.5 px-3 text-sm" : "h-6 gap-1.5 px-2.5 text-xs",
        st.pill,
      )}
    >
      <StatusDot status={status} onSolid={status === "read"} />
      {st.label}
    </span>
  );
}

/** 상태 점 — 진행중만 퍼지는 링(animate-ping)으로 살아 있는 느낌. */
export function StatusDot({ status, onSolid = false, className }: { status: string; onSolid?: boolean; className?: string }) {
  const st = inquiryStatusMeta(status);
  const color = onSolid ? "bg-white" : st.dot;
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {status === "read" ? <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-70", color)} /> : null}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}
