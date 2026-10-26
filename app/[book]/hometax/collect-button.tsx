"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DownloadCloudIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/admin/field";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { HOMETAX_DATE_TYPE_LABEL, type HometaxDateType } from "@/lib/hometax/types";
import { collectNow } from "./actions";

/**
 * [지금 수집] — 기간·기준일을 골라 팝빌 홈택스 수집을 바로 돌린다(매출+매입). 기본 전송일 기준 최근 7일.
 * 소급은 기준일을 '작성일'로 바꾸고 기간을 넓히면 된다. 완료까지 보통 수십 초.
 */
export function HometaxCollectButton({ books, defaultFrom, defaultTo }: { books: Book[]; defaultFrom: string; defaultTo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [book, setBook] = useState<Book>(books[0]);
  const [dateType, setDateType] = useState<HometaxDateType>("S");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggleCls = (on: boolean) => `rounded-md border px-2.5 py-1 text-xs ${on ? "bg-foreground text-background" : "bg-background"}`;

  function run() {
    setError(null);
    const fd = new FormData();
    fd.set("book", book);
    fd.set("date_type", dateType);
    fd.set("from", from);
    fd.set("to", to);
    start(async () => {
      const r = await collectNow(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const line = (label: string, x: typeof r.sell) =>
        x.ok ? `${label} ${x.found}건 (신규 ${x.inserted}, 갱신 ${x.updated})` : `${label} 실패: ${x.error}`;
      if (r.sell.ok || r.buy.ok) toast.success(`홈택스 수집 완료 — ${line("매출", r.sell)} · ${line("매입", r.buy)}`, { duration: 8000 });
      if (!r.sell.ok || !r.buy.ok) {
        const msg = !r.sell.ok ? r.sell.error : (r.buy as { ok: false; error: string }).error;
        if (!r.sell.ok && !r.buy.ok) setError(msg);
        else toast.error(msg, { duration: 10000 });
      }
      if (r.sell.ok && r.buy.ok) setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <DownloadCloudIcon className="size-4" /> 지금 수집
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>홈택스 계산서 지금 수집</DialogTitle>
            <DialogDescription>
              팝빌 홈택스 연계로 매출·매입 (세금)계산서를 가져옵니다. 이미 있는 건은 승인번호로 합쳐지니 기간이 겹쳐도 됩니다. 완료까지 수십 초 걸립니다.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {books.length > 1 ? (
              <Field label="책">
                <div className="flex gap-1">
                  {books.map((b) => (
                    <button type="button" key={b} onClick={() => setBook(b)} className={toggleCls(book === b)}>
                      {BOOK_LABEL[b]}
                    </button>
                  ))}
                </div>
              </Field>
            ) : null}
            <Field label="기준일">
              <div className="flex gap-1">
                {(Object.keys(HOMETAX_DATE_TYPE_LABEL) as HometaxDateType[]).map((k) => (
                  <button type="button" key={k} onClick={() => setDateType(k)} className={toggleCls(dateType === k)}>
                    {HOMETAX_DATE_TYPE_LABEL[k]}
                  </button>
                ))}
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                평소엔 전송일(상대가 발행한 다음 날 홈택스에 올라옴). 과거를 소급할 땐 작성일로 바꾸고 기간을 넓히세요.
              </p>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="시작일">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="종료일">
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              닫기
            </Button>
            <Button type="button" onClick={run} disabled={pending}>
              {pending ? "수집 중..." : "수집 시작"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
