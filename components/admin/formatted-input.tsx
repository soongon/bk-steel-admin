"use client";

import { type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { formatBusinessNoInput, formatPhoneInput } from "@/lib/format";

/** 자동 대시 형식 — phone: 전화·팩스·휴대폰, bizNo: 사업자등록번호. */
export type NumberFormat = "phone" | "bizNo";

const FORMATTERS: Record<NumberFormat, (s: string) => string> = {
  phone: formatPhoneInput,
  bizNo: formatBusinessNoInput,
};

/**
 * 입력값을 형식대로 다시 쓰고 커서를 '같은 개수의 숫자 뒤'에 둔다 — 중간 수정·대시 삽입에도 커서가 끝으로 튀지 않게.
 * DOM 값을 먼저 바꾸고 호출측 onChange 가 e.target.value(형식 적용값)를 읽으므로 제어·비제어 입력 모두 동작.
 */
function reformat(el: HTMLInputElement, format: (s: string) => string) {
  const raw = el.value;
  const next = format(raw);
  if (next === raw) return;
  const digitsBefore = raw.slice(0, el.selectionStart ?? raw.length).replace(/\D/g, "").length;
  let caret = 0;
  for (let seen = 0; caret < next.length && seen < digitsBefore; caret++) if (/\d/.test(next[caret])) seen++;
  el.value = next;
  el.setSelectionRange(caret, caret);
}

/**
 * Input + 번호 자동 대시 — format 을 주면 치는 대로 대시를 넣는다(전화 010-1234-5678, 사업자번호 000-00-00000).
 * 저장은 각 서버 액션이 digitsOnly 로 숫자만 남기므로 화면 형식과 무관. format 이 없으면 일반 Input.
 */
export function FormattedInput({
  format,
  type,
  inputMode,
  onChange,
  ...props
}: ComponentProps<typeof Input> & { format?: NumberFormat }) {
  return (
    <Input
      {...props}
      type={format === "phone" ? "tel" : type}
      inputMode={format === "phone" ? "tel" : format === "bizNo" ? "numeric" : inputMode}
      onChange={(e) => {
        if (format) reformat(e.currentTarget, FORMATTERS[format]);
        onChange?.(e);
      }}
    />
  );
}
