import { type ReactNode } from "react";
import { type BookView, BOOK_VIEW_BADGE_CLASS } from "@/lib/book";
import { cn } from "@/lib/utils";

/**
 * 대시보드의 KPI 단일 카드.
 * - title: 카드 제목 (작은 글씨)
 * - value: 큰 숫자/금액 표시
 * - hint: 보조 설명 (예: '4건 정상 + 2건 단기')
 * - book: 책 강조 색상 누적 (선택)
 * - children: 카드 하단에 임의 콘텐츠 (책별 breakdown 등)
 */
export function KpiCard({
  title,
  value,
  hint,
  book,
  children,
}: {
  title: string;
  value: string;
  hint?: string;
  book?: BookView;
  children?: ReactNode;
}) {
  const accent = book
    ? BOOK_VIEW_BADGE_CLASS[book].split(" ").filter((c) => c.startsWith("border-"))[0]
    : "";

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-card p-4 ring-1 ring-foreground/10",
        accent,
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  );
}
