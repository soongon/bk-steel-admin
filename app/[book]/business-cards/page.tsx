import { createClient } from "@/lib/supabase/server";
import { BusinessCardViews, type BusinessCardWithMeta } from "./business-card-views";
import { type Attachment } from "@/lib/attachment";

export default async function BusinessCardsPage({
  params,
}: {
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  const supabase = await createClient();

  const [cardsRes, partnersRes] = await Promise.all([
    supabase
      .from("business_card")
      .select(
        "id, collected_on, partner_id, name, title, company, phone, email, address, notes, partner:partner_id(code, name)",
      )
      .is("deleted_at", null)
      .order("collected_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("partner")
      .select("id, code, name")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const error = cardsRes.error ?? partnersRes.error;
  const cards = (cardsRes.data ?? []) as Array<
    Omit<BusinessCardWithMeta, "partner" | "thumbnail_url" | "sales_count" | "attachments">
    & { partner: { code: string; name: string } | { code: string; name: string }[] | null }
  >;
  const ids = cards.map((c) => c.id);

  // attachment + sales count 병렬 fetch
  const [attsRes, salesRes] = ids.length
    ? await Promise.all([
        supabase
          .from("attachment")
          .select(
            "id, entity_type, entity_id, kind, storage, path, url, thumbnail_url, mime, bytes, width, height, caption, sort_order, created_at",
          )
          .eq("entity_type", "business_card")
          .in("entity_id", ids)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("sales_log")
          .select("business_card_id")
          .in("business_card_id", ids)
          .is("deleted_at", null),
      ])
    : [{ data: [] as Attachment[] }, { data: [] as { business_card_id: string }[] }];

  const attsByEntity = new Map<string, Attachment[]>();
  for (const a of (attsRes.data ?? []) as Attachment[]) {
    const arr = attsByEntity.get(a.entity_id) ?? [];
    arr.push(a);
    attsByEntity.set(a.entity_id, arr);
  }

  const salesCountMap = new Map<string, number>();
  for (const s of (salesRes.data ?? []) as { business_card_id: string | null }[]) {
    if (!s.business_card_id) continue;
    salesCountMap.set(s.business_card_id, (salesCountMap.get(s.business_card_id) ?? 0) + 1);
  }

  const rows: BusinessCardWithMeta[] = cards.map((c) => {
    const atts = attsByEntity.get(c.id) ?? [];
    // Supabase가 nested select 결과를 단일/배열로 반환하는 경우 모두 대응
    const partner = Array.isArray(c.partner) ? c.partner[0] ?? null : c.partner;
    return {
      id: c.id,
      collected_on: c.collected_on,
      partner_id: c.partner_id,
      name: c.name,
      title: c.title,
      company: c.company,
      phone: c.phone,
      email: c.email,
      address: c.address,
      notes: c.notes,
      partner: partner ?? null,
      thumbnail_url: atts[0]?.url ?? null,
      sales_count: salesCountMap.get(c.id) ?? 0,
      attachments: atts,
    };
  });

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">명함</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            영업 활동의 출발점 — 명함 등록 후 영업내역·거래처로 이관
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
        <BusinessCardViews rows={rows} partners={partnersRes.data ?? []} book={book} />
      )}
    </div>
  );
}
