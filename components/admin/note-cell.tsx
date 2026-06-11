"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
