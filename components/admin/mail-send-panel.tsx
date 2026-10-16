"use client";

import { useState } from "react";
import { MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_MAIL_RECIPIENTS, type MailStatus, mailToError, parseEmails } from "@/lib/mail/address";

const DISABLED: Record<Exclude<MailStatus, "ready">, { label: string; title: string }> = {
  unconfigured: {
    label: "메일 설정 필요",
    title: "회사 메일 계정이 설정되면 쓸 수 있습니다(관리자: Vercel 환경변수 MAIL_SMTP_HOST·MAIL_SMTP_USER·MAIL_SMTP_PASS)",
  },
  "b-book": { label: "메일 불가 (B계좌)", title: "B계좌 문서는 메일로 보내지 않습니다(회사 메일함에 기록이 남음) — 필요하면 문자로 보내세요." },
  "no-company": { label: "메일 불가 (회사 정보 없음)", title: "설정 > 회사 정보를 먼저 채우세요." },
  "mixed-books": { label: "메일 불가 (책 혼합)", title: "여러 책이 섞인 누적 명세서는 메일로 보낼 수 없습니다 — 책별로 열어서 보내세요." },
};

/**
 * [메일 전송] 버튼 — 상태(mailStatusFor, 서버 계산)가 ready 가 아니면 이유를 적은 비활성 버튼.
 */
export function MailButton({
  status,
  onClick,
  size = "default",
  variant = "secondary",
}: {
  status: MailStatus;
  onClick: () => void;
  size?: "sm" | "default";
  variant?: "secondary" | "outline";
}) {
  if (status !== "ready") {
    const d = DISABLED[status];
    return (
      <span title={d.title}>
        <Button type="button" size={size} variant="outline" disabled>
          <MailIcon className="size-4" /> {d.label}
        </Button>
      </span>
    );
  }
  return (
    <Button type="button" size={size} variant={variant} onClick={onClick}>
      <MailIcon className="size-4" /> 메일 전송
    </Button>
  );
}

/**
 * 받는 메일 주소(여러 개는 쉼표) + 본문에 덧붙일 말 + 보내기. 문서 모달 안에서 문자 입력 칸처럼 펼친다.
 * 주소 검사는 여기서 먼저 하고, 서버 액션이 같은 규칙(parseEmails)으로 다시 검사한다.
 */
export function MailSendPanel({
  defaultTo,
  pending,
  onSend,
  onCancel,
}: {
  defaultTo: string;
  pending: boolean;
  onSend: (to: string, note: string) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const err = mailToError(parseEmails(to));
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onSend(to, note);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 print:hidden">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">받는 메일 * (여러 개는 쉼표, 최대 {MAX_MAIL_RECIPIENTS}개)</span>
        <Input
          type="text"
          inputMode="email"
          autoComplete="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="name@example.com"
        />
        {!defaultTo ? <span className="text-xs text-amber-600">거래처에 등록된 메일이 없습니다 — 직접 입력</span> : null}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">본문에 덧붙일 말 (선택)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="예: 10월분 거래명세서입니다."
          className="resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          취소
        </Button>
        <Button type="button" onClick={submit} disabled={pending}>
          <MailIcon className="size-4" /> {pending ? "보내는 중..." : "보내기"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">문서는 PDF로 첨부되고, 메일 본문에도 미리보기 이미지가 함께 들어갑니다.</p>
    </div>
  );
}
