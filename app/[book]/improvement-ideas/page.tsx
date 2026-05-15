import { createClient } from "@/lib/supabase/server";
import { IdeaList } from "./idea-list";
import { type IdeaRow } from "./idea-form-dialog";

export default async function ImprovementIdeasPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("improvement_idea")
    .select(
      "id, title, description, category, status, priority, proposed_at, resolved_at, notes",
    )
    .order("proposed_at", { ascending: false });

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">개선 아이디어</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            시스템·프로세스·영업·운영 개선 안 추적 — 자유롭게 적고 처리해 나가세요
          </p>
        </div>
        <span className="inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
          공유 마스터
        </span>
      </header>

      {error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          데이터 로딩 실패: {error.message}
        </div>
      ) : (
        <IdeaList ideas={(data ?? []) as IdeaRow[]} />
      )}
    </div>
  );
}
