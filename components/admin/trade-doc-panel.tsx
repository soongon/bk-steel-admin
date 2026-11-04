"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { CameraIcon, ImagePlusIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fmtKstDateTime } from "@/lib/format";
import { compressImage } from "@/lib/image-compress";
import { chunkBySize } from "@/lib/purchase-quote";
import {
  TRADE_DOC_BATCH_BYTES,
  TRADE_DOC_KINDS,
  TRADE_DOC_KIND_LABEL,
  TRADE_DOC_MAX,
  type TradeDocKind,
  type TradeDocSyncResult,
  type TradeDocView,
} from "@/lib/trade-doc";
import { AttachmentLightbox } from "@/components/admin/attachments/attachment-lightbox";

type Staged = { key: string; file: File; previewUrl: string; kind: TradeDocKind };
let seq = 0;

/** 서버 액션 호출 자체가 실패(연결 끊김·재배포 직후)하면 throw — 실패 결과로 바꾼다(메모 패널과 같은 처리). */
async function call(run: () => Promise<TradeDocSyncResult>): Promise<TradeDocSyncResult> {
  try {
    return await run();
  } catch (e) {
    return {
      ok: false,
      error: unstable_isUnrecognizedActionError(e)
        ? "새 버전이 배포됐습니다 — 새로고침한 뒤 다시 해 주세요."
        : "저장하지 못했습니다 — 연결을 확인하고 다시 해 주세요.",
    };
  }
}

const imageFilesOf = (list: FileList | null | undefined) =>
  Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));

/**
 * 거래 사진(매출·매입 상세 공용, 0099) — 계근표·현장·영수증 사진을 고르는 즉시 올린다(저장 버튼 없음).
 * 올리기 전에 브라우저에서 긴 변 2000px JPEG 로 줄이고(휴대폰 원본 3~8MB → 수백 KB), 3MB 단위로 나눠 보낸다.
 * 휴대폰에선 [사진 찍기]로 카메라를 바로 연다. 빼기는 올린 본인만(실제 권한은 RLS). 누르면 크게 본다.
 * syncAction 은 거래별 서버 액션(서버 페이지가 그대로 넘긴다 — 이름 끝이 Action).
 */
export function TradeDocPanel({
  parentId,
  docs: initial,
  loadError = false,
  currentUserId,
  canWrite,
  syncAction,
}: {
  parentId: string;
  docs: TradeDocView[];
  /** 서버가 목록을 읽지 못함 — 빈 것처럼 보여 같은 사진을 또 올리지 않게 올리기를 막고 새로고침을 권한다 */
  loadError?: boolean;
  currentUserId: string | null;
  /** 그 책 staff 이상 — 아니면 보기만 */
  canWrite: boolean;
  syncAction: (parentId: string, fd: FormData) => Promise<TradeDocSyncResult>;
}) {
  const [docs, setDocs] = useState(initial);
  const [stale, setStale] = useState(loadError); // 목록을 믿을 수 없음 — 새로고침 전엔 올리기 막음
  const [staged, setStaged] = useState<Staged[]>([]);
  const [kind, setKind] = useState<TradeDocKind>("weigh");
  const [preparing, setPreparing] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [busy, startBusy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const room = Math.max(0, TRADE_DOC_MAX - docs.length - staged.length);

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    if (room === 0) {
      toast.error(`사진은 거래당 ${TRADE_DOC_MAX}장까지입니다.`);
      return;
    }
    if (files.length > room) toast.info(`사진은 거래당 ${TRADE_DOC_MAX}장까지 — ${room}장만 올립니다.`);
    setPreparing(true);
    const next: Staged[] = [];
    for (const f of files.slice(0, room)) {
      try {
        const file = await compressImage(f);
        next.push({ key: `doc-${Date.now()}-${seq++}`, file, previewUrl: URL.createObjectURL(file), kind });
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : "이미지를 처리하지 못했습니다."}`);
      }
    }
    setPreparing(false);
    if (next.length === 0) return;
    setStaged((cur) => [...cur, ...next]);
    startBusy(async () => {
      let failed = 0;
      let errorShown = false;
      for (const batch of chunkBySize(next, (d) => d.file.size, TRADE_DOC_BATCH_BYTES)) {
        const fd = new FormData();
        for (const d of batch) {
          fd.append("file", d.file);
          fd.append("kind", d.kind);
        }
        const r = await call(() => syncAction(parentId, fd));
        if (r.ok) {
          if (r.docs) setDocs(r.docs);
          else setStale(true); // 올라갔지만 목록을 못 읽음 — 빈 목록으로 덮지 않는다
          failed += r.failed;
        } else {
          failed += batch.length;
          if (!errorShown) {
            toast.error(r.error);
            errorShown = true;
          }
        }
      }
      setStaged((cur) => cur.filter((d) => !next.includes(d)));
      for (const d of next) URL.revokeObjectURL(d.previewUrl);
      if (failed > 0 && !errorShown) toast.error(`${failed}장은 올리지 못했습니다(권한·상한·크기를 확인해 주세요).`);
      else if (failed === 0) toast.success(`사진 ${next.length}장을 올렸습니다`);
    });
  }

  function remove(doc: TradeDocView) {
    setConfirmId(null);
    const before = docs;
    setDocs((cur) => cur.filter((d) => d.id !== doc.id)); // 누르는 즉시 빼고, 못 뺐으면 되돌린다
    startBusy(async () => {
      const fd = new FormData();
      fd.append("remove_id", doc.id);
      const r = await call(() => syncAction(parentId, fd));
      if (!r.ok) {
        toast.error(r.error);
        setDocs(before);
      } else {
        if (r.docs) setDocs(r.docs);
        else setStale(true);
        if (r.failed > 0) toast.error("지울 수 없습니다 — 본인이 올린 사진만 지울 수 있습니다.");
      }
    });
  }

  const tile = "group relative aspect-square overflow-hidden rounded-md border bg-muted/40";
  const working = preparing || busy;
  const lightboxItems = docs.map((d) => ({ url: d.url, caption: `${TRADE_DOC_KIND_LABEL[d.kind]} · ${fmtKstDateTime(d.created_at)}` }));

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="text-sm font-medium">
          사진{docs.length > 0 ? <span className="font-normal text-muted-foreground"> · {docs.length}장</span> : null}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {working ? (
            <>
              <Loader2Icon className="size-3 animate-spin" aria-hidden /> {preparing ? "사진 줄이는 중" : "올리는 중"}
            </>
          ) : (
            "계근표 · 현장 · 영수증"
          )}
        </span>
      </div>

      <div className="p-3">
        {stale ? (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            사진 목록을 읽지 못했습니다 — 새로고침한 뒤 다시 봐 주세요. 그 전엔 같은 사진이 두 번 올라가지 않게 올리기를 막아 둡니다.
          </p>
        ) : null}
        {canWrite && !stale ? (
          // 올릴 사진 종류 — 고른 종류로 다음 사진이 올라간다(올린 뒤엔 못 바꾼다 — 빼고 다시 올림)
          <div className="mb-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="올릴 사진 종류">
            <span className="mr-0.5 text-xs text-muted-foreground">종류</span>
            {TRADE_DOC_KINDS.map((k) => {
              const on = k === kind;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKind(k)}
                  className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs transition-colors ${
                    on ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted"
                  }`}
                >
                  {TRADE_DOC_KIND_LABEL[k]}
                </button>
              );
            })}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto sm:hidden"
              disabled={working || room === 0}
              onClick={() => cameraRef.current?.click()}
            >
              <CameraIcon data-icon="inline-start" /> 사진 찍기
            </Button>
          </div>
        ) : null}

        {docs.length === 0 && staged.length === 0 && (!canWrite || stale) ? (
          <p className="py-4 text-center text-sm text-muted-foreground">올린 사진이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
            {docs.map((d, i) => {
              const mine = !!currentUserId && d.created_by === currentUserId;
              return (
                <div key={d.id} className={tile}>
                  <button type="button" onClick={() => setLightbox(i)} className="block size-full" title="크게 보기">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.url} alt={TRADE_DOC_KIND_LABEL[d.kind]} className="size-full object-cover" loading="lazy" decoding="async" />
                  </button>
                  <Badge className="bg-black/60">{TRADE_DOC_KIND_LABEL[d.kind]}</Badge>
                  {canWrite && mine ? (
                    confirmId === d.id ? (
                      // 타일 전체를 덮는 세로 배치 — 7rem 타일에도 들어간다
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/70 p-1 text-[11px] text-white">
                        <span className="whitespace-nowrap">지울까요?</span>
                        <span className="flex gap-1">
                          <Button type="button" size="xs" variant="destructive" disabled={busy} onClick={() => remove(d)}>
                            지우기
                          </Button>
                          <Button type="button" size="xs" variant="secondary" onClick={() => setConfirmId(null)}>
                            취소
                          </Button>
                        </span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(d.id)}
                        disabled={busy}
                        aria-label="이 사진 빼기"
                        className="absolute top-1 right-1 rounded-full bg-black/60 p-1.5 text-white hover:bg-destructive disabled:opacity-50"
                      >
                        <Trash2Icon className="size-3" />
                      </button>
                    )
                  ) : null}
                </div>
              );
            })}
            {staged.map((d) => (
              <div key={d.key} className={`${tile} opacity-70`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.previewUrl} alt="올리는 중" className="size-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-background/50">
                  <Loader2Icon className="size-5 animate-spin" />
                </span>
                <Badge className="bg-sky-600/90">{TRADE_DOC_KIND_LABEL[d.kind]} · 올리는 중</Badge>
              </div>
            ))}
            {canWrite && !stale && room > 0 ? (
              <label
                className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-zinc-300 p-2 text-center text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring dark:border-zinc-700 ${
                  working ? "pointer-events-none opacity-60" : ""
                }`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = imageFilesOf(e.dataTransfer.files);
                  if (files.length > 0) void addFiles(files);
                  else toast.error("사진 파일(JPEG·PNG·WebP)만 올릴 수 있습니다.");
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  disabled={working}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (fileRef.current) fileRef.current.value = "";
                    void addFiles(files);
                  }}
                />
                <ImagePlusIcon className="size-5" />
                <span className="font-medium text-foreground/80">사진 추가</span>
                <span className="text-[10px] leading-tight">
                  {TRADE_DOC_KIND_LABEL[kind]}로 올림 · {docs.length + staged.length}/{TRADE_DOC_MAX}
                </span>
              </label>
            ) : null}
          </div>
        )}
        {/* 휴대폰 카메라 — [사진 찍기] 버튼이 연다 */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (cameraRef.current) cameraRef.current.value = "";
            void addFiles(files);
          }}
        />
      </div>

      {lightbox !== null && lightboxItems[lightbox] ? (
        <AttachmentLightbox attachments={lightboxItems} index={lightbox} onClose={() => setLightbox(null)} onIndexChange={setLightbox} />
      ) : null}
    </section>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`pointer-events-none absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded px-1.5 py-0.5 text-[10px] text-white ${className}`}>
      {children}
    </span>
  );
}
