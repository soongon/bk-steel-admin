"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type Book, BOOK_LABEL } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { type CompanyProfile } from "@/lib/company-profile";
import { formatBusinessNo, formatPhone } from "@/lib/format";
import { updateCompanyProfile } from "./actions";

export function CompanyFormDialog({
  open,
  onOpenChange,
  book,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book: Book;
  profile: CompanyProfile | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateCompanyProfile(book, fd);
      if (r.ok) {
        toast.success(`${BOOK_LABEL[book]} 회사 정보가 저장되었습니다`);
        onOpenChange(false);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookBadge book={book} size="md" /> 회사 정보 편집
          </DialogTitle>
          <DialogDescription>
            거래명세표·세금계산서·견적서 등 외부 발급 문서에 공급자 정보로 사용됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3"
          key={`${book}-${profile?.business_no ?? "new"}`}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="상호 *" name="name" defaultValue={profile?.name} required />
            <Field label="사업자등록번호 *" name="business_no" defaultValue={formatBusinessNo(profile?.business_no)} placeholder="000-00-00000" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="대표자" name="representative" defaultValue={profile?.representative} />
            <Field label="업태" name="business_type" defaultValue={profile?.business_type} placeholder="도매 및 소매업" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="종목" name="business_item" defaultValue={profile?.business_item} placeholder="철강재" />
            <Field label="이메일" name="email" type="email" defaultValue={profile?.email} />
          </div>
          <Field label="사업장 주소" name="address" defaultValue={profile?.address} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="전화" name="phone" defaultValue={formatPhone(profile?.phone)} placeholder="054-000-0000" />
            <Field label="팩스" name="fax" defaultValue={formatPhone(profile?.fax)} />
            <Field label="휴대폰" name="mobile" defaultValue={formatPhone(profile?.mobile)} placeholder="010-0000-0000" />
          </div>

          <div className="rounded-md border-dashed border-2 border-zinc-300 p-3 dark:border-zinc-700">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              기본 입금 계좌 (명세서에 표기, 선택)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="은행명·예금주" name="bank_default_name" defaultValue={profile?.bank_default_name} placeholder="국민은행 / SL철강" />
              <Field label="계좌번호" name="bank_default_no" defaultValue={profile?.bank_default_no} placeholder="000-000000-00-000" />
            </div>
          </div>

          <Field label="비고" name="notes" defaultValue={profile?.notes} />

          {/* 인감(직인) 이미지 — 거래명세표·납품확인서에 표시 */}
          <div className="rounded-md border-dashed border-2 border-zinc-300 p-3 dark:border-zinc-700">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              인감(직인) 이미지 — 1MB 이하, PNG/JPG/WebP (배경 투명 PNG 권장)
            </p>
            <div className="flex items-center gap-3">
              {profile?.stamp_url ? (
                <img
                  src={profile.stamp_url}
                  alt="현재 인감"
                  className="size-16 rounded border bg-white object-contain"
                />
              ) : (
                <div className="flex size-16 items-center justify-center rounded border-2 border-dashed border-zinc-300 text-[10px] text-muted-foreground dark:border-zinc-700">
                  미등록
                </div>
              )}
              <input
                type="file"
                name="stamp_file"
                accept="image/png,image/jpeg,image/webp"
                className="block w-full text-xs file:mr-2 file:rounded file:border file:bg-muted file:px-2 file:py-1 file:text-xs"
              />
            </div>
            {profile?.stamp_url ? (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" name="stamp_clear" value="true" className="size-3.5" />
                인감 제거 (저장 시 삭제)
              </label>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  type,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}
