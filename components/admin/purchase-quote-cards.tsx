"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ContactIcon, ImagePlusIcon, Loader2Icon, XIcon, ZoomInIcon } from "lucide-react";
import { toast } from "sonner";
import { type Attachment } from "@/lib/attachment";
import { compressImage } from "@/lib/image-compress";
import { PURCHASE_QUOTE_CARD_MAX } from "@/lib/purchase-quote";
import { AttachmentLightbox } from "@/components/admin/attachments/attachment-lightbox";

/** 저장 전에 고른 명함 사진(축소본). 견적이 저장되면 그 id 로 업로드한다. */
export type StagedCard = { key: string; file: File; previewUrl: string };

export const revokeStagedCards = (cards: StagedCard[]) => cards.forEach((c) => URL.revokeObjectURL(c.previewUrl));

/**
 * 매입견적 폼의 판매자 명함 칸 — 기존 사진(수정) + 새로 고른 사진 미리보기, 추가·빼기.
 * 실제 업로드·삭제는 견적 저장 때 한 번에(PurchaseQuoteDialog). 여기서는 고른 사진을 축소(긴 변 2000px JPEG)만 한다.
 */
export function PurchaseQuoteCardPicker({
  kept,
  staged,
  onAdd,
  onRemoveKept,
  onRemoveStaged,
}: {
  kept: Attachment[];
  staged: StagedCard[];
  onAdd: (cards: StagedCard[]) => void;
  onRemoveKept: (id: string) => void;
  onRemoveStaged: (key: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const remaining = PURCHASE_QUOTE_CARD_MAX - kept.length - staged.length;

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (list.length === 0 || busy) return;
    if (remaining <= 0) {
      toast.error(`명함 사진은 최대 ${PURCHASE_QUOTE_CARD_MAX}장입니다.`);
      return;
    }
    if (list.length > remaining) toast.error(`명함 사진은 최대 ${PURCHASE_QUOTE_CARD_MAX}장 — ${remaining}장만 추가합니다.`);
    setBusy(true);
    const out: StagedCard[] = [];
    for (const f of list.slice(0, remaining)) {
      try {
        const file = await compressImage(f);
        out.push({ key: `${f.name}-${f.lastModified}-${out.length}-${Date.now()}`, file, previewUrl: URL.createObjectURL(file) });
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : "이미지를 처리하지 못했습니다."}`);
      }
    }
    setBusy(false);
    if (out.length > 0) onAdd(out);
  }

  const tile = "relative aspect-[1.6/1] overflow-hidden rounded-md border bg-muted/40";
  return (
    // 칸 수는 화면이 아니라 폭 기준 — 좁은 폼 다이얼로그에서도 미리보기가 2칸 크기로 보이게.
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      {kept.map((c, i) => (
        <div key={c.id} className={tile}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.url} alt={`판매자 명함 ${i + 1}`} className="size-full object-contain" />
          <RemoveButton onClick={() => onRemoveKept(c.id)} />
        </div>
      ))}
      {staged.map((c, i) => (
        <div key={c.key} className={tile}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.previewUrl} alt={`새 명함 ${i + 1}`} className="size-full object-contain" />
          <span className="absolute bottom-1 left-1 rounded bg-sky-600/90 px-1.5 py-0.5 text-[10px] text-white">저장 시 업로드</span>
          <RemoveButton onClick={() => onRemoveStaged(c.key)} />
        </div>
      ))}
      {remaining > 0 ? (
        <label
          className={`flex aspect-[1.6/1] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed p-2 text-center text-xs text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-ring ${
            dragOver ? "border-primary bg-primary/5" : "border-zinc-300 hover:bg-muted/60 dark:border-zinc-700"
          } ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => void handleFiles(e.target.files)}
          />
          {busy ? <Loader2Icon className="size-5 animate-spin" /> : <ImagePlusIcon className="size-5" />}
          <span>{busy ? "사진 줄이는 중..." : "명함 사진 추가"}</span>
          {!busy ? <span className="text-[10px]">촬영·사진 선택 · 앞/뒷면</span> : null}
        </label>
      ) : null}
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="명함 사진 빼기"
      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
    >
      <XIcon className="size-3" />
    </button>
  );
}

/**
 * 매입견적 상세의 판매자 명함 — 원본 비율 그대로 크게(잘리지 않게 contain), 누르면 전체 화면.
 * 문서 인쇄·문자 이미지와 무관한 참고 정보라 인쇄에서는 숨긴다.
 */
export function PurchaseQuoteCardPanel({ cards, sellerName }: { cards: Attachment[]; sellerName: string }) {
  const [index, setIndex] = useState<number | null>(null);
  if (cards.length === 0) return null;
  return (
    <section aria-label="판매자 명함" className="flex flex-col gap-2 rounded-lg border bg-card p-3 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-medium">
          <ContactIcon className="size-4 text-muted-foreground" /> 판매자 명함
        </h2>
        <span className="text-xs text-muted-foreground">
          {cards.length > 1 ? `${cards.length}장 · ` : ""}누르면 크게 보기
        </span>
      </div>
      {cards.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onClick={() => setIndex(i)}
          className="group relative overflow-hidden rounded-md border bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={c.url}
            alt={`${sellerName || "판매자"} 명함 ${i + 1}`}
            className="mx-auto block max-h-[28rem] w-full object-contain"
            decoding="async"
          />
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-full bg-black/55 p-1 text-white opacity-70 transition-opacity group-hover:opacity-100">
            <ZoomInIcon className="size-3.5" />
          </span>
        </button>
      ))}
      {/* body 로 띄운다 — sticky 칸(쌓임 맥락) 안에 두면 사이드바·표가 전체 화면 위로 올라온다. */}
      {index !== null
        ? createPortal(
            <AttachmentLightbox attachments={cards} index={index} onClose={() => setIndex(null)} onIndexChange={setIndex} />,
            document.body,
          )
        : null}
    </section>
  );
}
