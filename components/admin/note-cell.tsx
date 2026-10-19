"use client";

import { MessageSquareTextIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtKstDateTime } from "@/lib/format";

const NOTE_PREVIEW_LEN = 5;

/** 메모 셀 — 미리보기 길이 초과 시 말줄임 + 툴팁으로 전체보기. 매출/매입 목록 공용. */
export function NoteCell({ text }: { text: string | null }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  const isLong = text.length > NOTE_PREVIEW_LEN;
  const preview = isLong ? text.slice(0, NOTE_PREVIEW_LEN) + "…" : text;
  if (!isLong) return <span className="text-xs text-muted-foreground">{preview}</span>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="cursor-help text-xs text-muted-foreground underline decoration-dotted underline-offset-2" />
        }
      >
        {preview}
      </TooltipTrigger>
      <TooltipContent className="max-w-md whitespace-pre-wrap">{text}</TooltipContent>
    </Tooltip>
  );
}

/** 메모 기록 건수 배지 — 툴팁에 가장 최근 기록과 한국 시간. 매출 목록(상세에서 남긴 sale_memo). */
export function NoteLogBadge({ count, latest }: { count: number; latest: { body: string; created_at: string } | null }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex h-4 cursor-help items-center gap-0.5 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 tabular-nums dark:bg-emerald-950/40 dark:text-emerald-300" />
        }
      >
        <MessageSquareTextIcon className="size-2.5" aria-hidden />
        <span className="sr-only">메모 기록 </span>
        {count}
      </TooltipTrigger>
      <TooltipContent className="max-w-md whitespace-pre-wrap">
        {`메모 기록 ${count}건${latest ? `\n최근 ${fmtKstDateTime(latest.created_at)} — ${latest.body}` : ""}`}
      </TooltipContent>
    </Tooltip>
  );
}
