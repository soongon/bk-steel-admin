"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlusIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  uploadAttachment,
  type Attachment,
  type AttachmentEntityType,
} from "@/lib/attachment";

type Props = {
  entityType: AttachmentEntityType;
  entityId: string;
  kind?: string;
  multiple?: boolean;
  label?: string;
  onUploaded?: (attachment: Attachment) => void;
};

export function AttachmentUploader({
  entityType,
  entityId,
  kind,
  multiple = false,
  label,
  onUploaded,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const list = multiple ? Array.from(files) : [files[0]];
    startTransition(async () => {
      for (const file of list) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("entity_type", entityType);
        fd.set("entity_id", entityId);
        if (kind) fd.set("kind", kind);

        const result = await uploadAttachment(fd);
        if (result.ok) {
          onUploaded?.(result.attachment);
        } else {
          toast.error(`업로드 실패: ${result.error}`);
        }
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <label
      className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed bg-muted/30 p-4 text-sm text-muted-foreground transition-colors cursor-pointer ${
        dragOver ? "border-primary bg-primary/5" : "border-zinc-300 dark:border-zinc-700"
      } ${pending ? "pointer-events-none opacity-60" : "hover:bg-muted/60"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple={multiple}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={pending}
      />
      {pending ? (
        <>
          <Loader2Icon className="size-5 animate-spin" />
          <span>업로드 중...</span>
        </>
      ) : (
        <>
          <ImagePlusIcon className="size-5" />
          <span>{label ?? "이미지 추가 (드래그 또는 클릭)"}</span>
          <span className="text-xs">PNG · JPEG · WebP · 5MB 이하</span>
        </>
      )}
    </label>
  );
}

/**
 * 콤팩트 버전 — 버튼 형태. label 옆에 작게 띄울 때.
 */
export function AttachmentUploaderButton({
  entityType,
  entityId,
  kind,
  multiple = false,
  label = "사진 추가",
  onUploaded,
}: Props) {
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = multiple ? Array.from(files) : [files[0]];
    startTransition(async () => {
      for (const file of list) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("entity_type", entityType);
        fd.set("entity_id", entityId);
        if (kind) fd.set("kind", kind);

        const result = await uploadAttachment(fd);
        if (result.ok) {
          onUploaded?.(result.attachment);
        } else {
          toast.error(`업로드 실패: ${result.error}`);
        }
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple={multiple}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={pending}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
      >
        {pending ? <Loader2Icon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
        {label}
      </Button>
    </>
  );
}
