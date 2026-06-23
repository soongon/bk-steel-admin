"use client";

import { useLinkStatus } from "next/link";
import { Loader2Icon } from "lucide-react";

/**
 * <Link> 의 자식으로 두면 그 링크로 라우트 이동 중일 때만 작은 스피너를 보여준다.
 * (Next useLinkStatus — 클릭 즉시 피드백. 목록 → 상세 이동 등.)
 */
export function LinkSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <Loader2Icon className={`inline size-3 animate-spin text-muted-foreground ${className ?? "ml-1"}`} />;
}
