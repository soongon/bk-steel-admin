"use client";

import { useCallback, useEffect } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { type Attachment } from "@/lib/attachment";

type Props = {
  attachments: Attachment[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
};

/**
 * 큰 이미지 미리보기 — native dialog + ESC/방향키 단축.
 * 의도적으로 shadcn Dialog 안 씀 (이미지 풀스크린엔 native가 더 가벼움).
 */
export function AttachmentLightbox({ attachments, index, onClose, onIndexChange }: Props) {
  const total = attachments.length;
  const current = attachments[index];
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  const next = useCallback(() => {
    if (hasNext) onIndexChange(index + 1);
  }, [hasNext, index, onIndexChange]);
  const prev = useCallback(() => {
    if (hasPrev) onIndexChange(index - 1);
  }, [hasPrev, index, onIndexChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, next, prev]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="닫기"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <XIcon className="size-5" />
      </button>

      {hasPrev ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          aria-label="이전"
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
      ) : null}

      {hasNext ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          aria-label="다음"
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <ChevronRightIcon className="size-6" />
        </button>
      ) : null}

      <figure
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.caption ?? ""}
          className="max-h-[80vh] max-w-[90vw] rounded object-contain"
        />
        {current.caption ? (
          <figcaption className="text-center text-sm text-white/80">{current.caption}</figcaption>
        ) : null}
        {total > 1 ? (
          <div className="text-xs text-white/60">
            {index + 1} / {total}
          </div>
        ) : null}
      </figure>
    </div>
  );
}
