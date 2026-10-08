import { createClient } from "@/lib/supabase/server";
import { kstToday, lastSeenBySource, loadVisitRows } from "@/lib/radar/radar-data";
import type { VisitViewRow } from "@/lib/radar/visit-view";
import { type Book } from "@/lib/book";
import { type CompanyProfile } from "@/lib/company-profile";
import { type QuoteSources } from "@/components/admin/quote-dialog";
import { RadarV2 } from "./radar-v2";

/**
 * 발주 레이더 v2 — "오늘 할 일" 두 목록(방문 탭 · 전화 탭).
 * 방문 탭(경주 민간 착공·허가)만 화면. 전화 탭은 2주 콜 캠페인 판정 뒤(기획안 §9 D10).
 * 조회·규칙·상태 파생은 lib/radar/radar-data(loadVisitRows) — 알림·CSV·측정과 같은 함수.
 * ?focus={레이더 행 id}: 영업내역의 '레이더' 링크 — 그 행을 펼쳐 보여준다.
 * [견적]은 기존 견적 폼(QuoteDialog)을 책 선택 저장 모드로 재사용 — 공급자·품목·거래처 마스터를 함께 읽는다.
 */
export default async function RadarPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const { focus } = await searchParams;
  const supabase = await createClient();
  const today = kstToday();

  let rows: VisitViewRow[] = [];
  let synced: { building: string | null; nara: string | null } = { building: null, nara: null };
  let error: string | null = null;
  const sourcesP = Promise.all([
    supabase
      .from("partner")
      .select("id, code, name, business_no, representative, address, phone, fax, industry")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("item")
      .select("id, code, name, category, rebar_spec_code, rebar_grade_code, length_m, bars_per_tonne")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase.from("rebar_spec").select("spec_code, unit_weight_kg_per_m, standard_length_m").order("display_order"),
    supabase.from("company_profile").select("*"),
  ]);
  try {
    [rows, synced] = await Promise.all([loadVisitRows(supabase, today), lastSeenBySource(supabase)]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const [partnersRes, itemsRes, rebarSpecsRes, companyRes] = await sourcesP;
  const companies: Partial<Record<Book, CompanyProfile>> = {};
  for (const c of (companyRes.data ?? []) as CompanyProfile[]) {
    if (c.book) companies[c.book as Book] = c;
  }
  // [견적] 폼 데이터(거래처·품목·규격·공급자) — 하나라도 실패하면 빈 목록으로 열지 않고 [견적]을 잠근다.
  const quoteSourcesError =
    [partnersRes.error, itemsRes.error, rebarSpecsRes.error, companyRes.error].find(Boolean)?.message ?? null;
  const quoteSources: QuoteSources = {
    partners: (partnersRes.data ?? []) as QuoteSources["partners"],
    items: (itemsRes.data ?? []) as QuoteSources["items"],
    rebarSpecs: (rebarSpecsRes.data ?? []) as QuoteSources["rebarSpecs"],
    companies,
  };

  if (error) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">발주 레이더</h1>
        </header>
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">데이터를 불러오지 못했습니다: {error}</p>
          <p className="mt-1 text-xs">
            컬럼이 없다면 마이그레이션 <code>0069</code>~<code>0073</code> 적용이 필요합니다.
            데이터가 없으면 <code>npm run radar:collect</code>(키 필요)로 수집하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 md:p-6">
      <RadarV2
        rows={rows}
        today={today}
        synced={synced}
        quoteSources={quoteSources}
        quoteSourcesError={quoteSourcesError}
        focusId={focus ?? null}
      />
    </div>
  );
}
