import {
  BOOK_VIEW_BADGE_CLASS,
  BOOK_VIEW_LABEL,
  type Book,
  type BookView,
} from "@/lib/book";
import { cn } from "@/lib/utils";

/**
 * 책 라벨 배지. DB·API에서는 'bk'/'sl'/'b' 만 다루고,
 * UI 출력은 항상 이 컴포넌트로만.
 *
 * 'all' (전체)도 받아서 메뉴/URL 컨텍스트에 사용 가능.
 */
export function BookBadge({
  book,
  className,
  size = "sm",
}: {
  book: BookView | Book;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        BOOK_VIEW_BADGE_CLASS[book],
        className,
      )}
    >
      {BOOK_VIEW_LABEL[book]}
    </span>
  );
}
