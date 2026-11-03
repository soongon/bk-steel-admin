"use client";

import { useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteInquiry } from "./actions";

/**
 * 목록 행 휴지통 — 확인 창을 거쳐 홈페이지 DB 에서 문의를 실제로 지운다(되돌릴 수 없음).
 * 브라우저 confirm 대신 Dialog(운영 화면 일관·자동화 시험 가능).
 */
export function InquiryDeleteButton({ id, label }: { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const r = await deleteInquiry(id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("문의를 삭제했습니다");
      setOpen(false);
    });
  }

  return (
    <>
      <Button size="icon-xs" variant="ghost" onClick={() => setOpen(true)} aria-label="문의 삭제" title="삭제">
        <Trash2Icon className="text-destructive" />
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문의를 삭제할까요?</DialogTitle>
            <DialogDescription>
              {label} — 홈페이지 관리자에서도 함께 사라지고 되돌릴 수 없습니다. 이 문의로 만든 견적서·거래처는 그대로 남습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={handleDelete}>
              {pending ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
