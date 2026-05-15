"use client";

import { useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteAttachment, type Attachment } from "@/lib/attachment";
import { AttachmentLightbox } from "./attachment-lightbox";

type Props = {
  attachments: Attachment[];
  editable?: boolean;
  onDeleted?: (id: string) => void;
  /**
   * 썸네일 사이즈 — 카드뷰('card', 명함 비율 1.6:1) vs 그리드('square', 1:1)
   */
  variant?: "card" | "square";
  /** 빈 상태에 표시할 텍스트 */
  emptyLabel?: string;
};

export function AttachmentGallery({
  attachments,
  editable = false,
  onDeleted,
  variant = "square",
  emptyLabel = "첨부 없음",
}: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  function handleDelete(att: Attachment, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm("이 이미지를 삭제하시겠습니까?")) return;
    startTransition(async () => {
      const result = await deleteAttachment(att.id);
      if (result.ok) {
        toast.success("삭제되었습니다");
        onDeleted?.(att.id);
      } else {
        toast.error(result.error);
      }
    });
  }

  if (attachments.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const aspectClass = variant === "card" ? "aspect-[1.6/1]" : "aspect-square";

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {attachments.map((att, i) => (
          <div
            key={att.id}
            role="button"
            tabIndex={0}
            onClick={() => setLightboxIndex(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setLightboxIndex(i);
              }
            }}
            className={`group relative cursor-pointer overflow-hidden rounded-md border bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${aspectClass}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={att.url}
              alt={att.caption ?? ""}
              className="size-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
            {editable ? (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={(e) => handleDelete(att, e)}
                aria-label="삭제"
                className="absolute right-1 top-1 bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
              >
                <Trash2Icon className="size-3" />
              </Button>
            ) : null}
            {att.kind ? (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {att.kind}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {lightboxIndex !== null ? (
        <AttachmentLightbox
          attachments={attachments}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      ) : null}
    </>
  );
}
