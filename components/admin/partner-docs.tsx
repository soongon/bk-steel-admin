"use client";

import { useRef, useState } from "react";
import { ImagePlusIcon, Loader2Icon, ScanTextIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/image-compress";
import { PARTNER_DOC_KIND_LABEL, type PartnerDocKind, type PartnerDocView } from "@/lib/biz-doc";

/** 저장 전에 고른 사업자 이미지(축소본) — 거래처를 저장할 때(또는 자동 등록할 때) 올린다. */
export type StagedPartnerDoc = { key: string; file: File; previewUrl: string; kind: PartnerDocKind };

export const revokeStagedDocs = (docs: StagedPartnerDoc[]) => docs.forEach((d) => URL.revokeObjectURL(d.previewUrl));

let seq = 0;
/** 고른 사진을 긴 변 2000px JPEG 로 줄인다(AI 인식·저장 공용). 못 읽은 파일은 알리고 뺀다. */
export async function stagePartnerDocFiles(files: File[]): Promise<StagedPartnerDoc[]> {
  const out: StagedPartnerDoc[] = [];
  for (const f of files) {
    try {
      const file = await compressImage(f);
      out.push({ key: `doc-${Date.now()}-${seq++}`, file, previewUrl: URL.createObjectURL(file), kind: "other" });
    } catch (e) {
      toast.error(`${f.name}: ${e instanceof Error ? e.message : "이미지를 처리하지 못했습니다."}`);
    }
  }
  return out;
}

/** 클립보드·끌어다 놓기에서 사진 파일만 */
export const imageFilesOf = (list: FileList | null | undefined) =>
  Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));

/**
 * 거래처 폼의 사업자 이미지 칸 — 저장된 이미지(누르면 새 탭에서 원본) + 새로 고른 이미지 미리보기 + 추가 칸.
 * 실제 업로드·삭제는 폼이 저장할 때 한 번에(PartnerFormDialog). 여기서는 파일을 받아 넘기기만 한다.
 * 끌어다 놓기·붙여넣기는 다이얼로그가 화면 전체에서 받는다(놓친 파일을 브라우저가 열지 않게) — 여기서는 강조만.
 */
export function PartnerDocPicker({
  kept,
  staged,
  loading,
  readingKey,
  disabled,
  canAdd,
  addTitle,
  addHint,
  onFiles,
  onRemoveKept,
  onRemoveStaged,
}: {
  kept: PartnerDocView[];
  staged: StagedPartnerDoc[];
  /** 저장된 이미지 불러오는 중 */
  loading?: boolean;
  /** AI 가 읽고 있는 새 이미지 */
  readingKey?: string | null;
  /** 줄이는 중·읽는 중·등록 중 — 추가·빼기를 막는다 */
  disabled?: boolean;
  canAdd: boolean;
  addTitle: string;
  addHint: string;
  onFiles: (files: File[]) => void;
  onRemoveKept: (id: string) => void;
  onRemoveStaged: (key: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tile = "group relative aspect-[4/3] overflow-hidden rounded-md border bg-muted/40";

  return (
    // 칸 수는 화면이 아니라 폭 기준 — 좁은 폼 다이얼로그에서도 3칸 안팎
    <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
      {kept.map((d) => (
        <div key={d.id} className={tile}>
          <a href={d.url} target="_blank" rel="noopener noreferrer" title="새 탭에서 크게 보기" className="block size-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.url} alt={PARTNER_DOC_KIND_LABEL[d.kind]} className="size-full object-contain" decoding="async" />
          </a>
          <Badge className="bg-black/60">{PARTNER_DOC_KIND_LABEL[d.kind]}</Badge>
          <RemoveButton disabled={disabled} onClick={() => onRemoveKept(d.id)} />
        </div>
      ))}
      {staged.map((d) => (
        <div key={d.key} className={tile}>
          <a href={d.previewUrl} target="_blank" rel="noopener noreferrer" title="새 탭에서 크게 보기" className="block size-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.previewUrl} alt="새 사업자 이미지" className="size-full object-contain" />
          </a>
          {readingKey === d.key ? (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/70 text-xs font-medium">
              <Loader2Icon className="size-5 animate-spin" /> 읽는 중…
            </span>
          ) : (
            <Badge className="bg-sky-600/90">{d.kind === "other" ? "저장 시 올림" : `${PARTNER_DOC_KIND_LABEL[d.kind]} · 저장 시 올림`}</Badge>
          )}
          <RemoveButton disabled={disabled} onClick={() => onRemoveStaged(d.key)} />
        </div>
      ))}
      {loading ? (
        <div className={`${tile} flex items-center justify-center text-xs text-muted-foreground`}>
          <Loader2Icon className="size-4 animate-spin" />
        </div>
      ) : null}
      {canAdd ? (
        <label
          className={`flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed p-2 text-center text-xs text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-ring ${
            dragOver ? "border-primary bg-primary/5" : "border-zinc-300 hover:bg-muted/60 dark:border-zinc-700"
          } ${disabled ? "pointer-events-none opacity-60" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={() => setDragOver(false)}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={disabled}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (inputRef.current) inputRef.current.value = "";
              if (files.length > 0) onFiles(files);
            }}
          />
          {kept.length + staged.length === 0 ? <ScanTextIcon className="size-5" /> : <ImagePlusIcon className="size-5" />}
          <span className="font-medium text-foreground/80">{addTitle}</span>
          <span className="text-[10px] leading-tight">{addHint}</span>
        </label>
      ) : null}
    </div>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`pointer-events-none absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded px-1.5 py-0.5 text-[10px] text-white ${className}`}>
      {children}
    </span>
  );
}

function RemoveButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="사업자 이미지 빼기"
      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 disabled:opacity-50"
    >
      <XIcon className="size-3" />
    </button>
  );
}
