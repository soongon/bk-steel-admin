import { createClient } from "@/lib/supabase/server";
import { PartnerTable } from "./partner-table";
import { type PartnerPrefill, type PartnerRow } from "./partner-form-dialog";

// 거래처 폼의 사업자 이미지 AI 인식(서버 액션, 1장에 수 초~십여 초)이 이 화면에서 돈다 — 한 번 더 시도할 여유까지.
export const maxDuration = 60;

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ from_card?: string }>;
}) {
  const { from_card } = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partner")
    .select(
      "id, code, name, business_no, representative, phone, email, email2, address, industry, notes, is_active, docs:partner_document(count)",
    )
    .is("deleted_at", null)
    .order("code", { ascending: true });
  const partners: PartnerRow[] = ((data ?? []) as Array<PartnerRow & { docs?: Array<{ count: number }> }>).map(
    ({ docs, ...p }) => ({ ...p, doc_count: docs?.[0]?.count ?? 0 }),
  );

  // 명함에서 prefill 이관
  let prefill: PartnerPrefill | null = null;
  if (from_card) {
    const { data: card } = await supabase
      .from("business_card")
      .select("id, name, title, company, phone, email, address")
      .eq("id", from_card)
      .is("deleted_at", null)
      .single();
    if (card) {
      const titlePart = card.title ? ` (${card.title})` : "";
      prefill = {
        from_card_id: card.id,
        name: card.company,        // 회사명을 거래처명으로
        phone: card.phone,
        email: card.email,
        address: card.address,
        notes: `담당자: ${card.name}${titlePart}`,
      };
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">거래처</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            공유 마스터 — 모든 책에서 같은 데이터. 매출·매입의 거래처명 정합성 기준
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
        <PartnerTable partners={partners} prefill={prefill} />
      )}
    </div>
  );
}
