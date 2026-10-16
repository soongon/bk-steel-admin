import { LEAD_SOURCE_CLS, LEAD_SOURCE_LABEL, isLeadSource } from "@/lib/lead-source";

/** 유입경로 배지 — 미기록(NULL)은 점선 회색으로 눈에 띄게(측정 구멍을 보이게). */
export function LeadSourceBadge({ source, note, showNone = true }: { source: string | null | undefined; note?: string | null; showNone?: boolean }) {
  if (!isLeadSource(source)) {
    if (!showNone) return null;
    return (
      <span className="inline-flex h-5 items-center rounded-full border border-dashed px-2 text-xs text-muted-foreground" title="유입경로 미기록">
        미기록
      </span>
    );
  }
  return (
    <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${LEAD_SOURCE_CLS[source]}`} title={note ?? undefined}>
      {LEAD_SOURCE_LABEL[source]}
    </span>
  );
}
