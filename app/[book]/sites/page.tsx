import { createClient } from "@/lib/supabase/server";
import { SiteTable } from "./site-table";

export default async function SitesPage() {
  const supabase = await createClient();
  const [sitesRes, salesRes] = await Promise.all([
    supabase
      .from("site")
      .select(
        "id, code, name, address, city, client_name, owner_name, owner_address, status, started_on, ended_on, notes, is_active",
      )
      .is("deleted_at", null)
      .order("code", { ascending: true }),
    supabase
      .from("sale")
      .select("site_id, ordered_on")
      .not("site_id", "is", null)
      .is("deleted_at", null)
      .order("ordered_on", { ascending: true }),
  ]);
  const { data, error } = sitesRes;

  // site_id 별 첫 납품일 — 매출이 ordered_on asc 정렬되어 있으므로 first occurrence
  const firstSaleBySite = new Map<string, string>();
  for (const s of (salesRes.data ?? []) as Array<{
    site_id: string | null;
    ordered_on: string;
  }>) {
    if (s.site_id && !firstSaleBySite.has(s.site_id)) {
      firstSaleBySite.set(s.site_id, s.ordered_on);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">현장</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            공유 마스터 — 모든 책에서 같은 데이터. 매출·납품확인서의 현장 식별 기준
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
        <SiteTable
          sites={data ?? []}
          firstSaleBySite={Object.fromEntries(firstSaleBySite)}
        />
      )}
    </div>
  );
}
