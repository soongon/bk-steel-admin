import { Skeleton } from "@/components/ui/skeleton";

/**
 * 라우트 전환 로딩 UI — [book] 세그먼트의 page 가 서버에서 준비되는 동안 본문만 표시.
 * layout(사이드바 + 헤더)은 감싸지 않으므로 그대로 유지되고, <main>{children}</main> 자리만 이 fallback.
 * 목록·상세·폼·대시보드 어디에나 어울리는 범용 스켈레톤(헤더 2줄 + 카드 3 + 콘텐츠).
 */
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6" aria-busy="true" aria-label="불러오는 중">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="min-h-96 flex-1" />
    </div>
  );
}
