import { ExternalLinkIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { HOMEPAGE_URL } from "@/lib/inquiry";
import { cn } from "@/lib/utils";

/** 홈페이지 DB 연결이 없거나 실패했을 때 — 이유 + 홈페이지 관리자로 가는 길. */
export function InquiryUnavailable({ error, unconfigured }: { error: string; unconfigured?: boolean }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">홈페이지 문의</h1>
      </header>
      <div className="rounded-lg border border-dashed bg-card p-6 text-sm">
        <p className="font-medium">홈페이지 문의를 불러오지 못했습니다.</p>
        <p className="mt-1 text-muted-foreground">{error}</p>
        {unconfigured ? (
          <p className="mt-1 text-muted-foreground">
            어드민 환경변수에 홈페이지 Supabase 주소와 서비스 롤 키를 넣고 다시 배포하면 여기서 바로 보입니다.
          </p>
        ) : null}
        <a
          href={`${HOMEPAGE_URL}/admin/inquiries`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}
        >
          홈페이지 관리자에서 보기 <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
