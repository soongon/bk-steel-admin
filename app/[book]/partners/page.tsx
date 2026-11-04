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

  // 최근 거래 1건씩(매출·매입 주문일) — '최근 거래순' 정렬·카드 표시. 임베드에도 거래 RLS 가 걸려 책 권한(B계좌 격리) 그대로.
  const { data, error } = await supabase
    .from("partner")
    .select(
      "id, code, name, business_no, representative, phone, email, email2, address, business_type, business_item, notes, is_active, docs:partner_document(count), last_sale:sale(ordered_on), last_purchase:purchase(ordered_on)",
    )
    .is("deleted_at", null)
    .is("last_sale.deleted_at", null)
    .neq("last_sale.status", "cancelled")
    .is("last_purchase.deleted_at", null)
    .order("code", { ascending: true })
    .order("ordered_on", { referencedTable: "last_sale", ascending: false })
    .limit(1, { referencedTable: "last_sale" })
    .order("ordered_on", { referencedTable: "last_purchase", ascending: false })
    .limit(1, { referencedTable: "last_purchase" });
  type Raw = PartnerRow & { docs?: Array<{ count: number }>; last_sale?: Array<{ ordered_on: string }>; last_purchase?: Array<{ ordered_on: string }> };
  const partners: PartnerRow[] = ((data ?? []) as Raw[]).map(({ docs, last_sale, last_purchase, ...p }) => ({
    ...p,
    doc_count: docs?.[0]?.count ?? 0,
    last_sale_on: last_sale?.[0]?.ordered_on ?? null,
    last_purchase_on: last_purchase?.[0]?.ordered_on ?? null,
  }));

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
