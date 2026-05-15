import { createClient } from "@/lib/supabase/server";
import { SalesLogTable } from "./sales-log-table";
import { type SalesLogPrefill } from "./sales-log-form-dialog";

export default async function SalesLogPage({
  searchParams,
}: {
  searchParams: Promise<{ from_card?: string }>;
}) {
  const { from_card } = await searchParams;
  const supabase = await createClient();

  const [logsRes, partnersRes] = await Promise.all([
    supabase
      .from("sales_log")
      .select(
        "id, contacted_on, partner_id, prospect_name, contact_person, channel, result, follow_up_on, notes, partner:partner_id(code, name)",
      )
      .is("deleted_at", null)
      .order("contacted_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("partner")
      .select("id, code, name")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  // 명함에서 prefill 이관
  let prefill: SalesLogPrefill | null = null;
  if (from_card) {
    const { data: card } = await supabase
      .from("business_card")
      .select("id, partner_id, name, title, company, phone")
      .eq("id", from_card)
      .is("deleted_at", null)
      .single();
    if (card) {
      const today = new Date().toISOString().slice(0, 10);
      const titlePart = card.title ? ` (${card.title})` : "";
      prefill = {
        business_card_id: card.id,
        contacted_on: today,
        contact_person: card.name,
        partner_id: card.partner_id,
        prospect_name: card.partner_id ? null : card.company,
        channel: "visit",
        notes: `명함: ${card.name}${titlePart}${card.phone ? ` · ${card.phone}` : ""}`,
      };
    }
  }

  const error = logsRes.error ?? partnersRes.error;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">영업내역</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            콜드 prospecting + follow-up 추적 — 등록 거래처와 미등록 잠재 거래처 모두 기록
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
        <SalesLogTable
          rows={(logsRes.data ?? []) as unknown as Parameters<typeof SalesLogTable>[0]["rows"]}
          partners={partnersRes.data ?? []}
          prefill={prefill}
        />
      )}
    </div>
  );
}
