import Link from "next/link";
import { ArrowLeftIcon, RadarIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";

/**
 * 발주 레이더 레이아웃 — [book] 밖 독립 라우트.
 * 운영(매출·매입·통장)과 분리된 외부 공공데이터 영역이라 책 사이드바를 쓰지 않고
 * 자체 헤더(+ 운영 시스템으로 돌아가는 링크)만 둔다. 인증은 proxy.ts가 전역 가드.
 */
export default function RadarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Link
          href="/all/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          운영 시스템
        </Link>
        <Separator orientation="vertical" className="h-5" />
        <div className="flex items-center gap-2">
          <RadarIcon className="size-4 text-rose-500" />
          <span className="text-sm font-medium">발주 레이더</span>
          <span className="rounded-md border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground">
            법인 · 외부 공공데이터
          </span>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
