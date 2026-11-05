"use client";

import { useOptimistic, useState, useTransition } from "react";
import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
import { Loader2Icon, MessageSquarePlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtKstDateTime, kstWeekday } from "@/lib/format";
import { MEMO_MAX, type MemoAddResult, type MemoDeleteResult, type MemoEntry } from "@/lib/memo-log";

type ShownMemo = MemoEntry & { pending?: boolean };
type Change = { type: "add"; memo: ShownMemo } | { type: "remove"; id: string };

const byTime = (a: ShownMemo, b: ShownMemo) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** 서버 액션 호출 자체가 실패(연결 끊김·재배포 직후·게이트웨이 오류)하면 throw — 화면 전체 오류로 번지지 않게 실패 결과로 바꾼다. */
async function call<T extends { ok: boolean }>(run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
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

/**
 * 거래 메모 기록(매출·매입 상세 공용) — 시간순(오래된 것이 위, 새 메모는 입력칸 바로 위)으로 한국 시간과 함께.
 * 맨 위 '등록 메모'는 거래 등록·수정 폼의 메모(notes, 목록 메모 칸과 같은 값)라 여기선 보기만 한다.
 * 추가·삭제는 누르는 즉시 반영하고(운영에선 저장·다시 그리기에 몇 초 걸린다) 실패하면 되돌린다.
 * addMemoAction·deleteMemoAction 은 거래별 서버 액션(서버 페이지가 그대로 넘긴다 — Next 규칙대로 이름 끝이 Action).
 * composer="none" 이면 아래 입력칸을 빼고 보기만 — 쓰기는 머리의 MemoAddButton(모달)으로(문의 상세).
 */
export function MemoLogPanel({
  parentId,
  registeredNote,
  registeredLabel,
  memos,
  currentUserId,
  addMemoAction,
  deleteMemoAction,
  composer = "inline",
}: {
  composer?: "inline" | "none";
  parentId: string;
  registeredNote: string | null;
  /** 등록 메모 출처 설명 — 예: '매출 등록·수정에서 쓴 메모'. registeredNote 가 있을 때만 쓴다. */
  registeredLabel?: string;
  memos: MemoEntry[];
  currentUserId: string | null;
  addMemoAction: (parentId: string, body: string) => Promise<MemoAddResult>;
  deleteMemoAction: (memoId: string) => Promise<MemoDeleteResult>;
}) {
  // 같은 id 는 하나만, 늘 시간순 — 삭제 실패로 되살릴 때도 원래 자리로.
  const [shown, apply] = useOptimistic<ShownMemo[], Change>(memos, (list, change) =>
    change.type === "remove"
      ? list.filter((m) => m.id !== change.id)
      : [...list.filter((m) => m.id !== change.memo.id), change.memo].sort(byTime),
  );
  const [text, setText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function add() {
    const body = text.trim();
    if (!body) return;
    setText("");
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    startSaving(async () => {
      apply({
        type: "add",
        memo: { id: tempId, body, created_at: new Date().toISOString(), created_by: currentUserId, pending: true },
      });
      const r = await call(() => addMemoAction(parentId, body));
      if (!r.ok) {
        toast.error(r.error);
        // 다른 저장이 아직 진행 중이어도 실패한 줄은 바로 빼고(낙관 상태는 모든 저장이 끝나야 풀린다),
        // 쓰던 내용은 입력칸에 돌려준다 — 그새 새로 쓴 글이 있으면 앞에 붙여 둘 다 남긴다.
        startSaving(() => apply({ type: "remove", id: tempId }));
        setText((cur) => (cur.trim() ? `${body}\n${cur}` : body));
      }
    });
  }

  function remove(memo: ShownMemo) {
    setConfirmId(null);
    startSaving(async () => {
      apply({ type: "remove", id: memo.id });
      const r = await call(() => deleteMemoAction(memo.id));
      if (!r.ok) {
        toast.error(r.error);
        startSaving(() => apply({ type: "add", memo })); // 지우지 못했으면 원래 자리로 바로 되돌린다
      }
    });
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="text-sm font-medium">
          메모{shown.length > 0 ? <span className="font-normal text-muted-foreground"> · 기록 {shown.length}건</span> : null}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {saving ? (
            <>
              <Loader2Icon className="size-3 animate-spin" aria-hidden /> 저장 중
            </>
          ) : (
            "시간순 · 한국 시간"
          )}
        </span>
      </div>

      {registeredNote ? (
        <div className="border-b bg-muted/30 px-4 py-2.5">
          <div className="text-xs text-muted-foreground">등록 메모{registeredLabel ? ` · ${registeredLabel}` : ""}</div>
          <p className="mt-0.5 text-sm whitespace-pre-wrap">{registeredNote}</p>
        </div>
      ) : null}

      <ol className="divide-y">
        {shown.length === 0 ? (
          <li className="px-4 py-5 text-center text-sm text-muted-foreground">
            {registeredNote ? "추가 기록 없음 — 아래에 남기면 시간순으로 쌓입니다." : composer === "none" ? "아직 남긴 메모가 없습니다 — 위 [메모 남기기]로." : "아직 남긴 메모가 없습니다."}
          </li>
        ) : (
          shown.map((m) => {
            const mine = !m.pending && !!currentUserId && m.created_by === currentUserId;
            return (
              <li key={m.id} className={m.pending ? "px-4 py-2.5 opacity-60" : "px-4 py-2.5"}>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {/* 날짜는 요일과 함께 크게, 시각은 작게 — 언제 통화했는지가 먼저 보이게 */}
                  <time dateTime={m.created_at} className="tabular-nums">
                    <span className="text-sm font-semibold text-foreground">
                      {fmtKstDateTime(m.created_at).slice(0, 10)} ({kstWeekday(m.created_at)})
                    </span>{" "}
                    {fmtKstDateTime(m.created_at).slice(11)}
                  </time>
                  {m.pending ? <span>저장 중…</span> : null}
                  {mine ? (
                    confirmId === m.id ? (
                      <span className="ml-auto flex items-center gap-1">
                        <span>지울까요?</span>
                        <Button type="button" size="xs" variant="destructive" onClick={() => remove(m)}>
                          지우기
                        </Button>
                        <Button type="button" size="xs" variant="ghost" onClick={() => setConfirmId(null)}>
                          취소
                        </Button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(m.id)}
                        className="ml-auto inline-flex items-center gap-0.5 hover:text-destructive"
                        aria-label="이 메모 지우기"
                      >
                        <Trash2Icon className="size-3" /> 삭제
                      </button>
                    )
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{m.body}</p>
              </li>
            );
          })
        )}
      </ol>

      {composer === "none" ? null : (
      <div className="border-t p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 줄바꿈은 Enter, 저장은 ⌘/Ctrl+Enter (한글 조합 중 Enter 는 무시)
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
          rows={2}
          maxLength={MEMO_MAX}
          placeholder="메모 남기기 — 통화·입금 약속·납품 변경 등"
          aria-label="새 메모"
          className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {text.length > MEMO_MAX * 0.9 ? `${text.length.toLocaleString()} / ${MEMO_MAX.toLocaleString()}자` : "남긴 시각이 함께 기록됩니다 · ⌘/Ctrl+Enter 저장"}
          </span>
          <Button type="button" size="sm" onClick={add} disabled={!text.trim()}>
            메모 추가
          </Button>
        </div>
      </div>
      )}
    </section>
  );
}

/**
 * 머리 [메모 남기기] 버튼 + 모달 — 문의 상세처럼 메모 칸이 입력칸 없이 보기만일 때(composer="none").
 * 저장하면 router.refresh() 로 메모 칸이 서버에서 다시 온다(사진 올리기와 같은 방식). 저장 실패면 쓰던 글은 남겨 둔다.
 */
export function MemoAddButton({ parentId, addMemoAction }: { parentId: string; addMemoAction: (parentId: string, body: string) => Promise<MemoAddResult> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, startSaving] = useTransition();

  function add() {
    const body = text.trim();
    if (!body) return;
    startSaving(async () => {
      const r = await call(() => addMemoAction(parentId, body));
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setText("");
      setOpen(false);
      toast.success("메모를 남겼습니다");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MessageSquarePlusIcon className="size-4" /> 메모 남기기
      </Button>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="!max-w-[min(32rem,calc(100%-2rem))]">
          <DialogHeader>
            <DialogTitle>메모 남기기</DialogTitle>
            <DialogDescription>통화·진행 상황을 시간순으로 남깁니다. 남긴 시각이 함께 기록됩니다.</DialogDescription>
          </DialogHeader>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                add();
              }
            }}
            rows={5}
            maxLength={MEMO_MAX}
            autoFocus
            placeholder="메모 — 통화 내용·약속·다음 할 일 등"
            aria-label="새 메모"
            className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          />
          <DialogFooter className="sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {text.length > MEMO_MAX * 0.9 ? `${text.length.toLocaleString()} / ${MEMO_MAX.toLocaleString()}자` : "⌘/Ctrl+Enter 저장"}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
                닫기
              </Button>
              <Button type="button" disabled={saving || !text.trim()} onClick={add}>
                {saving ? "저장 중..." : "메모 추가"}
              </Button>
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
