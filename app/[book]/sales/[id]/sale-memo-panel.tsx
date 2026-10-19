"use client";

import { useOptimistic, useState, useTransition } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fmtKstDateTime } from "@/lib/format";
import { SALE_MEMO_MAX, type SaleMemo } from "@/lib/sale-memo";
import { addSaleMemo, deleteSaleMemo } from "./memo-actions";

type ShownMemo = SaleMemo & { pending?: boolean };
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
 * 매출 메모 기록 — 시간순(오래된 것이 위, 새 메모는 입력칸 바로 위)으로 한국 시간과 함께.
 * 맨 위 '등록 메모'는 매출 등록·수정 폼의 메모(sale.notes, 목록 메모 칸과 같은 값)라 여기선 보기만 한다.
 * 추가·삭제는 누르는 즉시 반영하고(운영에선 저장·다시 그리기에 몇 초 걸린다) 실패하면 되돌린다.
 */
export function SaleMemoPanel({
  saleId,
  registeredNote,
  memos,
  currentUserId,
}: {
  saleId: string;
  registeredNote: string | null;
  memos: SaleMemo[];
  currentUserId: string | null;
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
      const r = await call(() => addSaleMemo(saleId, body));
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
      const r = await call(() => deleteSaleMemo(memo.id));
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
          <div className="text-xs text-muted-foreground">등록 메모 · 매출 등록·수정에서 쓴 메모</div>
          <p className="mt-0.5 text-sm whitespace-pre-wrap">{registeredNote}</p>
        </div>
      ) : null}

      <ol className="divide-y">
        {shown.length === 0 ? (
          <li className="px-4 py-5 text-center text-sm text-muted-foreground">
            {registeredNote ? "추가 기록 없음 — 아래에 남기면 시간순으로 쌓입니다." : "아직 남긴 메모가 없습니다."}
          </li>
        ) : (
          shown.map((m) => {
            const mine = !m.pending && !!currentUserId && m.created_by === currentUserId;
            return (
              <li key={m.id} className={m.pending ? "px-4 py-2.5 opacity-60" : "px-4 py-2.5"}>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <time dateTime={m.created_at} className="tabular-nums">
                    {fmtKstDateTime(m.created_at)}
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
          maxLength={SALE_MEMO_MAX}
          placeholder="메모 남기기 — 통화·입금 약속·납품 변경 등"
          aria-label="새 메모"
          className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {text.length > SALE_MEMO_MAX * 0.9 ? `${text.length.toLocaleString()} / ${SALE_MEMO_MAX.toLocaleString()}자` : "남긴 시각이 함께 기록됩니다 · ⌘/Ctrl+Enter 저장"}
          </span>
          <Button type="button" size="sm" onClick={add} disabled={!text.trim()}>
            메모 추가
          </Button>
        </div>
      </div>
    </section>
  );
}
