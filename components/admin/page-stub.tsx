import { ConstructionIcon } from "lucide-react";
import { type BookView } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";

/**
 * 페이지 자리표시자. 본 페이지 구현 전까지 일관된 placeholder UI 제공.
 */
export function PageStub({
  title,
  description,
  book,
  isShared = false,
}: {
  title: string;
  description?: string;
  book?: BookView;
  isShared?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isShared ? (
            <span className="inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
              공유 마스터
            </span>
          ) : book ? (
            <BookBadge book={book} size="md" />
          ) : null}
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/30 p-12 text-center">
        <ConstructionIcon className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          이 화면은 v1 청사진에 포함되어 있고, 구현은 아직 시작 전입니다.
        </p>
      </div>
    </div>
  );
}
