import { type SupabaseClient } from "@supabase/supabase-js";
import { type Book } from "@/lib/book";
import {
  fetchDeliveryCertById,
  type DeliveryCertificate,
} from "@/lib/delivery-certificate";
import { type DeliveryCertData } from "@/components/admin/delivery-cert-form";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ko-KR");

/**
 * (book, partner_id, site_id) 단위 납품확인서 양식 데이터 빌드.
 * 동일 (book, partner, site) 의 모든 매출·라인을 모아 1장에 누적.
 * 현장 상세 페이지와 매출 상세 페이지 모두에서 사용.
 */
export async function buildDeliveryCertData(
  supabase: SupabaseClient,
  book: Book,
  partnerId: string,
  siteId: string,
): Promise<DeliveryCertData | null> {
  // 1. partner
  const { data: partner } = await supabase
    .from("partner")
    .select("id, name, business_no, representative, address")
    .eq("id", partnerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!partner) return null;

  // 2. site
  const { data: site } = await supabase
    .from("site")
    .select(
      "id, code, name, address, client_name, owner_name, owner_address",
    )
    .eq("id", siteId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!site) return null;

  // 3. sales + lines (해당 그룹)
  type RawSale = {
    id: string;
    doc_no: string;
    ordered_on: string;
    subtotal_krw: number | string;
    vat_krw: number | string;
    total_krw: number | string;
    delivery_cert_id: string | null;
    sale_line: Array<{
      id: string;
      qty: number | string;
      unit: string;
      weight_kg: number | string | null;
      theoretical_weight_kg: number | string | null;
      line_subtotal_krw: number | string | null;
      item: {
        name: string;
        category: string | null;
        rebar_spec_code: string | null;
        rebar_grade_code: string | null;
        length_m: number | null;
      } | null;
    }>;
  };

  const { data: rawSales } = await supabase
    .from("sale")
    .select(
      `
      id, doc_no, ordered_on, subtotal_krw, vat_krw, total_krw, delivery_cert_id,
      sale_line(
        id, qty, unit, weight_kg, theoretical_weight_kg, line_subtotal_krw,
        item:item(id, name, category, rebar_spec_code, rebar_grade_code, length_m)
      )
    `,
    )
    .eq("book", book)
    .eq("partner_id", partnerId)
    .eq("site_id", siteId)
    .is("deleted_at", null)
    .order("ordered_on");

  const sales = (rawSales ?? []) as unknown as RawSale[];
  if (sales.length === 0) return null;

  // 4. cert (있다면)
  const firstCertId = sales.find((s) => s.delivery_cert_id)?.delivery_cert_id ?? null;
  let cert: DeliveryCertificate | null = null;
  if (firstCertId) {
    cert = await fetchDeliveryCertById(supabase, firstCertId);
  }

  // 5. 집계
  let totalWeight = 0;
  let totalKrw = 0;
  const qtyByUnit = new Map<string, number>();
  const lines: DeliveryCertData["lines"] = [];

  for (const s of sales) {
    totalKrw += Number(s.total_krw);
    for (const l of s.sale_line) {
      const w =
        l.theoretical_weight_kg != null
          ? Number(l.theoretical_weight_kg)
          : l.weight_kg != null
            ? Number(l.weight_kg)
            : null;
      if (w != null) totalWeight += w;
      qtyByUnit.set(l.unit, (qtyByUnit.get(l.unit) ?? 0) + Number(l.qty));

      let spec = "";
      if (l.item?.category === "rebar" && l.item?.rebar_spec_code) {
        spec = [
          l.item.rebar_spec_code,
          l.item.rebar_grade_code,
          l.item.length_m ? `${l.item.length_m}M` : null,
        ]
          .filter(Boolean)
          .join(" ");
      }

      lines.push({
        ordered_on: s.ordered_on,
        item_name: l.item?.name ?? "—",
        spec,
        qty: Number(l.qty),
        unit: l.unit,
        weight_kg: w,
        subtotal_krw: l.line_subtotal_krw ? Number(l.line_subtotal_krw) : undefined,
        doc_no: s.doc_no,
      });
    }
  }

  const qtySummary = Array.from(qtyByUnit.entries())
    .map(([u, q]) => `${fmtNum(q)}${u}`)
    .join(" / ");

  const first = sales[0].ordered_on;
  const last = sales[sales.length - 1].ordered_on;

  return {
    cert,
    partner: {
      name: partner.name,
      business_no: partner.business_no,
      representative: partner.representative,
      address: partner.address,
    },
    site: {
      code: site.code,
      name: site.name,
      address: site.address,
      client_name: site.client_name,
      owner_name: site.owner_name,
      owner_address: site.owner_address,
    },
    lines,
    total_qty_summary: qtySummary,
    total_weight_kg: totalWeight,
    total_krw: totalKrw,
    period_from: first,
    period_to: last,
  };
}
