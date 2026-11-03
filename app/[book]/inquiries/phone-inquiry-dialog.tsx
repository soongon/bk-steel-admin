"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PhoneIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormattedInput } from "@/components/admin/formatted-input";
import { type BookView } from "@/lib/book";
import { INQUIRY_STATUSES, INQUIRY_TYPES, type InquiryStatus, type InquiryType, inquiryKindLabel } from "@/lib/inquiry";
import { LEAD_NOTE_PLACEHOLDER, LEAD_SOURCES, type LeadSource } from "@/lib/lead-source";
import { createPhoneInquiry } from "./actions";
import { StatusDot } from "./inquiry-status-pill";

/** 지금 한국 시각 — <input type="datetime-local"> 값 형식(YYYY-MM-DDTHH:mm). */
const kstNowLocal = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hourCycle: "h23" }).slice(0, 16).replace(" ", "T");

const toggleCls = (on: boolean) => `rounded-md border px-2.5 py-1 text-xs ${on ? "bg-foreground text-background" : "bg-background"}`;

/**
 * 전화 문의 직접 입력 — 홈페이지 문의와 같은 목록에 들어가 상태·견적 작성·거래처 등록을 그대로 쓴다.
 * 이미 통화한 문의라 상태는 '진행중'이 기본. 저장하면 상세로 가서 바로 견적서를 쓸 수 있다.
 */
export function PhoneInquiryButton({ view }: { view: BookView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inquiryType, setInquiryType] = useState<InquiryType>("매입 문의");
  const [status, setStatus] = useState<InquiryStatus>("read");
  const [leadSource, setLeadSource] = useState<LeadSource | null>(null);
  const [receivedAt, setReceivedAt] = useState("");
  const [formKey, setFormKey] = useState(0);

  function openDialog() {
    setError(null);
    setInquiryType("매입 문의");
    setStatus("read");
    setLeadSource(null);
    setReceivedAt(kstNowLocal());
    setFormKey((k) => k + 1); // 이름·전화 등 비제어 입력 비우기
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("inquiry_type", inquiryType);
    fd.set("status", status);
    fd.set("received_at", receivedAt);
    if (leadSource) fd.set("lead_source", leadSource);
    startTransition(async () => {
      const r = await createPhoneInquiry(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success("문의를 등록했습니다");
      setOpen(false);
      router.push(`/${view}/inquiries/${r.id}`);
    });
  }

  const leadNotePlaceholder = leadSource ? LEAD_NOTE_PLACEHOLDER[leadSource] : undefined;

  return (
    <>
      <Button size="sm" onClick={openDialog}>
        <PhoneIcon /> 문의 입력
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] !max-w-[min(32rem,calc(100%-2rem))] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>문의 입력</DialogTitle>
            <DialogDescription>전화로 받은 문의를 문의 목록에 남깁니다. 저장 후 바로 견적서를 쓸 수 있습니다.</DialogDescription>
          </DialogHeader>

          <form key={formKey} onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">구분 *</span>
              <div className="flex gap-1">
                {INQUIRY_TYPES.map((t) => (
                  <button type="button" key={t} onClick={() => setInquiryType(t)} className={`flex-1 ${toggleCls(inquiryType === t)}`}>
                    {inquiryKindLabel(t)} {t === "매입 문의" ? "(우리가 산다)" : "(우리가 판다)"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">이름 / 업체명 *</span>
                <Input name="name" required maxLength={100} placeholder="예: ○○건설 김소장" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">전화번호 *</span>
                <FormattedInput format="phone" name="phone" required placeholder="010-0000-0000" />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">현장 / 지역</span>
                <Input name="location" maxLength={200} placeholder="예: 경주 외동 현장" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">받은 시각</span>
                <Input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">문의 내용</span>
              <textarea
                name="message"
                rows={4}
                maxLength={2000}
                placeholder="규격·수량·시기 등 통화 내용"
                className="resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </label>

            {/* 유입경로 — label 로 감싸지 않는다(버튼 묶음 + 메모 입력이 한 칸). */}
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">유입경로 — 어디 보고 전화했나 (선택)</span>
              <div className="flex flex-wrap gap-1">
                {LEAD_SOURCES.map((s) => (
                  <button
                    type="button"
                    key={s.value}
                    onClick={() => setLeadSource((cur) => (cur === s.value ? null : s.value))}
                    className={toggleCls(leadSource === s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {leadSource && leadNotePlaceholder ? (
                <Input key={leadSource} name="lead_note" maxLength={200} placeholder={leadNotePlaceholder} className="mt-1" />
              ) : null}
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">상태</span>
              <div className="flex gap-1">
                {INQUIRY_STATUSES.map((s) => {
                  const on = status === s.value;
                  return (
                    <button
                      type="button"
                      key={s.value}
                      onClick={() => setStatus(s.value)}
                      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${on ? `border-transparent ${s.solid}` : "bg-background text-muted-foreground"}`}
                    >
                      <StatusDot status={s.value} onSolid={on} />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                취소
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "저장 중..." : "저장"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
