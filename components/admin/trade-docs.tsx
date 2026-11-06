"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
import { CameraIcon, CheckIcon, ImagePlusIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtKstDateTime } from "@/lib/format";
import { compressImage, imageAccept, ImageConvertStoppedError } from "@/lib/image-compress";
import { chunkBySize } from "@/lib/purchase-quote";
import {
  TRADE_DOC_BATCH_BYTES,
  TRADE_DOC_IMAGE,
  TRADE_DOC_KINDS,
  TRADE_DOC_KIND_LABEL,
  TRADE_DOC_MAX,
  TRADE_DOC_UNIT,
  type TradeDocKind,
  type TradeDocParent,
  type TradeDocSyncResult,
  type TradeDocView,
} from "@/lib/trade-doc";
import { AttachmentLightbox } from "@/components/admin/attachments/attachment-lightbox";

/**
 * 거래·문의 사진(매출·매입·문의 상세 공용, 0099·0100) — 두 조각. parent 로 종류 묶음·안내 문구가 갈린다.
 *   · TradeDocUploadButton: 머리 오른쪽 [수정] 왼쪽의 [사진 올리기] — 모달에서 종류를 고르고 사진을 고르면 즉시 올린다.
 *   · TradeDocGallery: 메모 아래 — 사진이 있을 때만. 누르면 크게 보고, 본인이 올린 사진은 뺀다.
 * 둘은 상태를 나누지 않는다 — 올리거나 뺀 뒤 router.refresh() 로 서버가 목록(서명 URL)을 다시 내려 준다.
 * 올리기 전에 브라우저에서 종류별 크기(TRADE_DOC_IMAGE)의 JPEG 로 줄이고(휴대폰 원본 3~8MB·HEIC → 수백 KB), 3MB 단위로 나눠 보낸다.
 * syncAction 은 거래별 서버 액션(서버 페이지가 그대로 넘긴다 — 이름 끝이 Action).
 */

type SyncAction = (parentId: string, fd: FormData) => Promise<TradeDocSyncResult>;
type Staged = { key: string; file: File; previewUrl: string; kind: TradeDocKind; done?: boolean };
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

const TILE = "group relative aspect-square overflow-hidden rounded-md border bg-muted/40";

/** [사진 올리기] 버튼 + 모달. count = 지금 올라가 있는 장수(상한 계산). loadError 면 같은 사진이 두 번 올라가지 않게 막는다. */
export function TradeDocUploadButton({
  parent = "sale",
  parentId,
  count,
  loadError = false,
  syncAction,
}: {
  parent?: TradeDocParent;
  parentId: string;
  count: number;
  loadError?: boolean;
  syncAction: SyncAction;
}) {
  const kinds = TRADE_DOC_KINDS[parent];
  const unit = TRADE_DOC_UNIT[parent];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [kind, setKind] = useState<TradeDocKind>(kinds[0]);
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null); // 줄이는 중 진행(HEIC 는 장당 수 초)
  const [uploaded, setUploaded] = useState(0); // 이 창에서 올린 장수(닫으면 0)
  const [baseCount, setBaseCount] = useState(count); // 창을 열 때 서버 장수
  const [busy, startBusy] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const working = !!preparing || busy;
  // 서버 count 는 refresh 뒤에야 늘어난다 — 그 전엔 '열 때 장수 + 이 창에서 올린 장수'가 더 크므로 둘 중 큰 쪽으로 센다.
  const pending = staged.filter((d) => !d.done).length;
  const room = Math.max(0, TRADE_DOC_MAX - Math.max(count, baseCount + uploaded) - pending);

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    if (room === 0) {
      toast.error(`사진은 ${unit}당 ${TRADE_DOC_MAX}장까지입니다.`);
      return;
    }
    if (files.length > room) toast.info(`사진은 ${unit}당 ${TRADE_DOC_MAX}장까지 — ${room}장만 올립니다.`);
    const picked = files.slice(0, room);
    setPreparing({ done: 0, total: picked.length });
    const next: Staged[] = [];
    for (const [i, f] of picked.entries()) {
      try {
        const file = await compressImage(f, TRADE_DOC_IMAGE[kind]);
        next.push({ key: `doc-${Date.now()}-${seq++}`, file, previewUrl: URL.createObjectURL(file), kind });
      } catch (e) {
        if (e instanceof ImageConvertStoppedError) {
          toast.error(e.message); // 다음 장도 같은 결과 — 한 번만 알리고 멈춘다(이미 줄인 장은 올린다)
          break;
        }
        toast.error(`${f.name}: ${e instanceof Error ? e.message : "이미지를 처리하지 못했습니다."}`);
      }
      setPreparing({ done: i + 1, total: picked.length });
    }
    setPreparing(null);
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
          failed += r.failed;
          setUploaded((n) => n + batch.length - r.failed);
          // 올라간 것은 '올림' 표시로 남기고(어떤 사진을 올렸는지 보이게), 못 올린 것은 뺀다.
          // 서버는 장수만 돌려주므로 상한에 걸려 안 올라간 뒤쪽 장으로 본다.
          const dropped = new Set(batch.slice(batch.length - r.failed));
          setStaged((cur) => cur.filter((d) => !dropped.has(d)).map((d) => (batch.includes(d) ? { ...d, done: true } : d)));
        } else {
          failed += batch.length;
          setStaged((cur) => cur.filter((d) => !batch.includes(d)));
          if (!errorShown) {
            toast.error(r.error);
            errorShown = true;
          }
        }
      }
      router.refresh(); // 메모 아래 사진 칸·머리 장수를 서버에서 다시
      if (failed > 0 && !errorShown) toast.error(`${failed}장은 올리지 못했습니다(권한·상한·크기를 확인해 주세요).`);
      else if (failed === 0) toast.success(`사진 ${next.length}장을 올렸습니다`);
    });
  }

  function close() {
    if (working) return;
    for (const d of staged) URL.revokeObjectURL(d.previewUrl);
    setStaged([]);
    setUploaded(0);
    setOpen(false);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setBaseCount(count);
          setOpen(true);
        }}
        disabled={loadError} title={loadError ? "사진 목록을 읽지 못해 올리기를 막아 둡니다 — 새로고침해 주세요" : undefined}>
        <CameraIcon className="size-4" /> 사진 올리기
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="!max-w-[min(36rem,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>사진 올리기</DialogTitle>
            <DialogDescription>
              {kinds.map((k) => TRADE_DOC_KIND_LABEL[k]).join("·")} — 종류를 고른 뒤 사진을 고르면 바로 올라갑니다. {unit}당 {TRADE_DOC_MAX}장까지. 글자가 작으면 가까이서 찍어 주세요.
            </DialogDescription>
          </DialogHeader>

          {/* 올릴 사진 종류 — 고른 종류로 다음 사진이 올라간다(올린 뒤엔 못 바꾼다 — 빼고 다시 올림) */}
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="올릴 사진 종류">
            <span className="mr-0.5 text-xs text-muted-foreground">종류</span>
            {kinds.map((k) => {
              const on = k === kind;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={working} // 진행 중인 사진은 고를 때의 종류로 올라간다 — 바꾼 것처럼 보이지 않게
                  onClick={() => setKind(k)}
                  className={`inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors disabled:opacity-60 ${
                    on ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted"
                  }`}
                >
                  {TRADE_DOC_KIND_LABEL[k]}
                </button>
              );
            })}
          </div>

          <label
            className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-zinc-300 p-4 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring dark:border-zinc-700 ${
              working || room === 0 ? "pointer-events-none opacity-60" : ""
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const files = imageFilesOf(e.dataTransfer.files);
              if (files.length > 0) void addFiles(files);
              else toast.error("사진 파일(JPEG·PNG·WebP·HEIC)만 올릴 수 있습니다.");
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept={imageAccept()}
              multiple
              className="sr-only"
              disabled={working || room === 0}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (fileRef.current) fileRef.current.value = "";
                void addFiles(files);
              }}
            />
            {working ? <Loader2Icon className="size-6 animate-spin" /> : <ImagePlusIcon className="size-6" />}
            <span className="font-medium text-foreground/80">
              {preparing ? `사진 줄이는 중… ${preparing.done}/${preparing.total}` : busy ? "올리는 중…" : room === 0 ? "더 올릴 수 없습니다" : "사진 고르기 · 끌어다 놓기"}
            </span>
            <span className="text-xs">
              {TRADE_DOC_KIND_LABEL[kind]}로 올림 · {TRADE_DOC_MAX - room}/{TRADE_DOC_MAX}
            </span>
          </label>

          {staged.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
              {staged.map((d) => (
                <div key={d.key} className={`${TILE} ${d.done ? "" : "opacity-70"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.previewUrl} alt={d.done ? "올림" : "올리는 중"} className="size-full object-cover" />
                  {d.done ? (
                    <span className="absolute top-1 right-1 rounded-full bg-emerald-600 p-1 text-white">
                      <CheckIcon className="size-3" />
                    </span>
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center bg-background/50">
                      <Loader2Icon className="size-5 animate-spin" />
                    </span>
                  )}
                  <Badge className={d.done ? "bg-emerald-600/90" : "bg-sky-600/90"}>
                    {TRADE_DOC_KIND_LABEL[d.kind]} · {d.done ? "올림" : "올리는 중"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : null}

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

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" className="sm:hidden" disabled={working || room === 0} onClick={() => cameraRef.current?.click()}>
              <CameraIcon className="size-4" /> 사진 찍기
            </Button>
            <Button type="button" variant={uploaded > 0 ? "default" : "outline"} disabled={working} onClick={close}>
              {uploaded > 0 ? `닫기 (${uploaded}장 올림)` : "닫기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 메모 아래 사진 칸 — 사진이 있거나(docs) 읽기 실패(loadError)일 때만 서버 페이지가 그린다. */
export function TradeDocGallery({
  parentId,
  docs,
  loadError = false,
  currentUserId,
  canWrite,
  syncAction,
}: {
  /** 안내·종류 묶음 구분용(지금은 표시엔 안 쓴다 — 종류 라벨은 공용 표) */
  parent?: TradeDocParent;
  parentId: string;
  docs: TradeDocView[];
  loadError?: boolean;
  currentUserId: string | null;
  /** 그 책 staff 이상 — 아니면 보기만 */
  canWrite: boolean;
  syncAction: SyncAction;
}) {
  const router = useRouter();
  // 누르는 즉시 빼고, 서버 목록이 다시 오면(refresh) 그 값으로 — 못 뺐으면 원래 목록으로 돌아온다.
  const [shown, hide] = useOptimistic<TradeDocView[], string>(docs, (list, id) => list.filter((d) => d.id !== id));
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [busy, startBusy] = useTransition();

  function remove(doc: TradeDocView) {
    setConfirmId(null);
    startBusy(async () => {
      hide(doc.id);
      const fd = new FormData();
      fd.append("remove_id", doc.id);
      const r = await call(() => syncAction(parentId, fd));
      if (!r.ok) toast.error(r.error);
      else if (r.failed > 0) toast.error("지울 수 없습니다 — 본인이 올린 사진만 지울 수 있습니다.");
      router.refresh();
    });
  }

  const items = shown.map((d) => ({ url: d.url, caption: `${TRADE_DOC_KIND_LABEL[d.kind]} · ${fmtKstDateTime(d.created_at)}` }));

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="text-sm font-medium">
          사진{shown.length > 0 ? <span className="font-normal text-muted-foreground"> · {shown.length}장</span> : null}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {busy ? (
            <>
              <Loader2Icon className="size-3 animate-spin" aria-hidden /> 저장 중
            </>
          ) : (
            "누르면 크게 보기"
          )}
        </span>
      </div>
      <div className="p-3">
        {loadError ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            사진 목록을 읽지 못했습니다 — 새로고침한 뒤 다시 봐 주세요.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
            {shown.map((d, i) => {
              const mine = !!currentUserId && d.created_by === currentUserId;
              return (
                <div key={d.id} className={TILE}>
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
          </div>
        )}
      </div>
      {lightbox !== null && items[lightbox] ? (
        <AttachmentLightbox attachments={items} index={lightbox} onClose={() => setLightbox(null)} onIndexChange={setLightbox} />
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
