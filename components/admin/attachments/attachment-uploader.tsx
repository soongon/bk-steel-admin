"use client";

import { useRef, useState, useTransition, type RefObject } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { ImagePlusIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { compressImage, imageAccept, ImageConvertStoppedError } from "@/lib/image-compress";
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

/**
 * 고른 사진을 줄여서(긴 변 2000px JPEG, HEIC 포함) 차례로 올린다.
 * 휴대폰 원본은 서버 액션 본문 상한(4MB)을 넘기 쉽다 — 줄이지 않으면 액션이 결과 없이 실패한다.
 */
function useAttachmentUpload(
  { entityType, entityId, kind, multiple = false, onUploaded }: Props,
  inputRef: RefObject<HTMLInputElement | null>,
) {
  const [pending, startTransition] = useTransition();

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = multiple ? Array.from(files) : [files[0]];
    startTransition(async () => {
      for (const original of list) {
        let file: File;
        try {
          file = await compressImage(original);
        } catch (e) {
          if (e instanceof ImageConvertStoppedError) {
            toast.error(e.message); // 다음 장도 같은 결과 — 한 번만 알리고 멈춘다
            break;
          }
          toast.error(`${original.name}: ${e instanceof Error ? e.message : "이미지를 처리하지 못했습니다."}`);
          continue;
        }

        const fd = new FormData();
        fd.set("file", file);
        fd.set("entity_type", entityType);
        fd.set("entity_id", entityId);
        if (kind) fd.set("kind", kind);

        try {
          const result = await uploadAttachment(fd);
          if (result.ok) {
            onUploaded?.(result.attachment);
          } else {
            toast.error(`업로드 실패: ${result.error}`);
          }
        } catch (e) {
          // 액션 호출 자체가 실패(연결 끊김·재배포 직후) — 남은 장도 같으므로 멈춘다
          toast.error(
            unstable_isUnrecognizedActionError(e)
              ? "새 버전이 배포됐습니다 — 새로고침한 뒤 다시 해 주세요."
              : "업로드하지 못했습니다 — 연결을 확인하고 다시 해 주세요.",
          );
          break;
        }
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return { pending, handleFiles };
}

export function AttachmentUploader(props: Props) {
  const { multiple = false, label } = props;
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { pending, handleFiles } = useAttachmentUpload(props, inputRef);

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
        accept={imageAccept()}
        multiple={multiple}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={pending}
      />
      {pending ? (
        <>
          <Loader2Icon className="size-5 animate-spin" />
          <span>사진 줄여서 올리는 중...</span>
        </>
      ) : (
        <>
          <ImagePlusIcon className="size-5" />
          <span>{label ?? "이미지 추가 (드래그 또는 클릭)"}</span>
          <span className="text-xs">JPEG · PNG · WebP · HEIC</span>
        </>
      )}
    </label>
  );
}

/**
 * 콤팩트 버전 — 버튼 형태. label 옆에 작게 띄울 때.
 */
export function AttachmentUploaderButton(props: Props) {
  const { multiple = false, label = "사진 추가" } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const { pending, handleFiles } = useAttachmentUpload(props, inputRef);


  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={imageAccept()}
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
