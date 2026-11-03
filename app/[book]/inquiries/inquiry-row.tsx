"use client";

import { type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * 문의 목록 한 줄 — 셀 어디를 눌러도 상세로. 안의 링크(이름·전화)는 그대로 동작하고,
 * 키보드는 이름 링크로 들어간다(행 자체는 탭 순서에 넣지 않는다).
 */
export function InquiryRow({ href, className, ...props }: ComponentProps<typeof TableRow> & { href: string }) {
  const router = useRouter();
  return (
    <TableRow
      {...props}
      className={cn("cursor-pointer", className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button")) return;
        if (window.getSelection()?.toString()) return; // 글자 드래그 선택은 이동하지 않음
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
    />
  );
}
