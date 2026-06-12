import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon, FileTextIcon, MapPinIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type Book, type BookView } from "@/lib/book";
import { buttonVariants } from "@/components/ui/button";
import { BookBadge } from "@/components/admin/book-badge";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { type DeliveryCertificate } from "@/lib/delivery-certificate";
import {
  type DeliveryCertData,
} from "@/components/admin/delivery-cert-form";
import { SiteCertButton } from "./site-cert-button";
import { QuoteButton, type QuotePartner, type QuoteItem, type QuoteRebarSpec } from "@/components/admin/quote-dialog";
import { fmtKrw } from "@/lib/format";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ko-KR");

const STATUS_LABEL: Record<string, string> = {
  active: "진행",
  closed: "완료",
};

type RawSale = {
  id: string;
  book: Book;
  doc_no: string;
  ordered_on: string;
  delivered_on: string | null;
  status: string;
  subtotal_krw: number | string;
  vat_krw: number | string;
  total_krw: number | string;
  is_documented: boolean;
  tax_doc_type: string;
  partner_id: string;
  delivery_cert_id: string | null;
  partner: {
    id: string;
    name: string;
    code: string;
    business_no: string | null;
    representative: string | null;
    address: string | null;
  } | null;
  sale_line: Array<{
    id: string;
    qty: number | string;
    unit: string;
    weight_kg: number | string | null;
    theoretical_weight_kg: number | string | null;
    line_subtotal_krw: number | string | null;
    item: {
      id: string;
      name: string;
      category: string | null;
      rebar_spec_code: string | null;
      rebar_grade_code: string | null;
      length_m: number | null;
    } | null;
  }>;
};

type Group = {
  key: string;
  book: Book;
  partner: NonNullable<RawSale["partner"]>;
  sales: RawSale[];
  subtotal_krw: number;
  vat_krw: number;
  total_krw: number;
  total_weight_kg: number;
  total_qty_summary: string;
  first_ordered_on: string;
  last_ordered_on: string;
  delivery_cert_id: string | null;
  any_undocumented: boolean;
  line_count: number;
};

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ book: string; id: string }>;
}) {
  const { book: bookParam, id } = await params;
  const view = bookParam as BookView;
  const supabase = await createClient();

  // 1. 현장 메타
  const { data: site, error: siteErr } = await supabase
    .from("site")
    .select(
      "id, code, name, address, city, client_name, owner_name, owner_address, status, started_on, ended_on, notes",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (siteErr || !site) notFound();

  // 2. 그 현장의 매출 (view 책 기준)
  let salesQ = supabase
    .from("sale")
    .select(
      `
      id, book, doc_no, ordered_on, delivered_on, status,
      subtotal_krw, vat_krw, total_krw, is_documented, tax_doc_type,
      partner_id, delivery_cert_id,
      partner:partner(id, name, code, business_no, representative, address),
      sale_line(
        id, qty, unit, weight_kg, theoretical_weight_kg, line_subtotal_krw,
        item:item(id, name, category, rebar_spec_code, rebar_grade_code, length_m)
      )
    `,
    )
    .eq("site_id", id)
    .is("deleted_at", null)
    .order("ordered_on");
  if (view !== "all") salesQ = salesQ.eq("book", view);
  const { data: rawSales } = await salesQ;
  const sales = (rawSales ?? []) as unknown as RawSale[];

  // 3. 거래처 × 책 그룹화
  const groups = new Map<string, Group>();
  for (const s of sales) {
    if (!s.partner) continue;
    const key = `${s.book}-${s.partner.id}`;
    const subtotal = Number(s.subtotal_krw);
    const vat = Number(s.vat_krw);
    const total = Number(s.total_krw);
    const weightKg = s.sale_line.reduce(
      (acc, l) => acc + Number(l.theoretical_weight_kg ?? l.weight_kg ?? 0),
      0,
    );

    const prev = groups.get(key);
    if (prev) {
      prev.sales.push(s);
      prev.subtotal_krw += subtotal;
      prev.vat_krw += vat;
      prev.total_krw += total;
      prev.total_weight_kg += weightKg;
      prev.line_count += s.sale_line.length;
      if (s.ordered_on < prev.first_ordered_on) prev.first_ordered_on = s.ordered_on;
      if (s.ordered_on > prev.last_ordered_on) prev.last_ordered_on = s.ordered_on;
      if (s.delivery_cert_id) prev.delivery_cert_id = s.delivery_cert_id;
      if (!s.is_documented) prev.any_undocumented = true;
    } else {
      groups.set(key, {
        key,
        book: s.book,
        partner: s.partner,
        sales: [s],
        subtotal_krw: subtotal,
        vat_krw: vat,
        total_krw: total,
        total_weight_kg: weightKg,
        total_qty_summary: "",
        first_ordered_on: s.ordered_on,
        last_ordered_on: s.ordered_on,
        delivery_cert_id: s.delivery_cert_id,
        any_undocumented: !s.is_documented,
        line_count: s.sale_line.length,
      });
    }
  }

  // 그룹 정렬: 마지막 납품일 desc
  const groupList = Array.from(groups.values()).sort((a, b) =>
    b.last_ordered_on.localeCompare(a.last_ordered_on),
  );

  // 4. cert 일괄 조회 (그룹별 delivery_cert_id 유일값)
  const certIds = Array.from(
    new Set(groupList.map((g) => g.delivery_cert_id).filter(Boolean)),
  ) as string[];
  const certMap = new Map<string, DeliveryCertificate>();
  if (certIds.length > 0) {
    const { data: certs } = await supabase
      .from("delivery_certificate")
      .select("id, book, partner_id, site_id, site_name, doc_no, issued_on, issued_by, notes")
      .in("id", certIds);
    for (const c of (certs ?? []) as DeliveryCertificate[]) {
      certMap.set(c.id, c);
    }
  }

  // 5. 그룹별 company_profile (책 기준 — fetch는 책별로 캐시)
  const companyMap = new Map<Book, Awaited<ReturnType<typeof fetchCompanyProfile>>>();
  for (const g of groupList) {
    if (!companyMap.has(g.book)) {
      companyMap.set(g.book, await fetchCompanyProfile(supabase, g.book));
    }
  }

  // 견적서용 데이터 (거래처·품목·규격 + SL 공급자 명의)
  const [partnersRes, itemsRes, rebarSpecsRes, quoteCompany] = await Promise.all([
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
    fetchCompanyProfile(supabase, "sl"),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {/* 상단 액션 바 */}
      <div className="flex items-center justify-between">
        <Link
          href={`/${bookParam}/sites`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeftIcon className="size-4" />
          현장 목록
        </Link>
        <div className="flex items-center gap-2">
          <QuoteButton
            sources={{
              partners: (partnersRes.data ?? []) as QuotePartner[],
              items: (itemsRes.data ?? []) as QuoteItem[],
              rebarSpecs: (rebarSpecsRes.data ?? []) as QuoteRebarSpec[],
              company: quoteCompany,
            }}
            defaultSiteName={site.name}
          />
          <BookBadge book={view} size="md" />
        </div>
      </div>

      {/* 현장 메타 */}
      <header className="rounded-xl border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <MapPinIcon className="size-5 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">{site.name}</h1>
              <span className="font-mono text-xs text-muted-foreground">{site.code}</span>
              <span
                className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${
                  site.status === "active"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400"
                }`}
              >
                {STATUS_LABEL[site.status] ?? site.status}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
              {site.city ? <Meta label="지역" value={site.city} /> : null}
              {site.client_name ? (
                <Meta label="시공사" value={site.client_name} />
              ) : null}
              {site.started_on ? (
                <Meta
                  label="기간"
                  value={`${site.started_on}${site.ended_on ? ` ~ ${site.ended_on}` : ""}`}
                />
              ) : null}
              {site.address ? (
                <Meta label="현장 주소" value={site.address} colSpan />
              ) : null}
              <Meta
                label="건축주·사업명"
                value={site.owner_name ?? "(미등록 — 납품확인서 발급 전 입력 필요)"}
                colSpan
              />
              {site.owner_address ? (
                <Meta label="건축주 주소" value={site.owner_address} colSpan />
              ) : null}
              {site.notes ? <Meta label="비고" value={site.notes} colSpan /> : null}
            </dl>
          </div>
        </div>
      </header>

      {/* 거래처별 그룹 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">거래처별 납품 내역</h2>
        {groupList.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-12 text-center text-sm text-muted-foreground">
            이 현장에 등록된 매출이 없습니다.
          </div>
        ) : (
          groupList.map((g) => {
            const cert = g.delivery_cert_id ? certMap.get(g.delivery_cert_id) ?? null : null;
            const company = companyMap.get(g.book) ?? null;
            const formData = buildCertData(g, site, cert);
            return (
              <div
                key={g.key}
                className="rounded-xl border bg-card p-4 ring-1 ring-foreground/5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <BookBadge book={g.book} />
                      <span className="text-base font-semibold">{g.partner.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {g.partner.code}
                      </span>
                      {g.any_undocumented ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          무자료 포함
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {g.first_ordered_on}
                      {g.first_ordered_on !== g.last_ordered_on
                        ? ` ~ ${g.last_ordered_on}`
                        : ""}{" "}
                      · 매출 {g.sales.length}건 · 라인 {g.line_count}건
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/${bookParam}/sites/${id}/statement?partner=${g.partner.id}&book=${g.book}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      <FileTextIcon className="size-4" />
                      거래명세표
                    </Link>
                    <SiteCertButton
                      book={g.book}
                      partnerId={g.partner.id}
                      siteId={site.id}
                      cert={cert}
                      formData={formData}
                      company={company}
                    />
                  </div>
                </div>

                {/* 합계 */}
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
                  <Stat label="공급가액" value={fmtKrw(g.subtotal_krw)} />
                  <Stat label="세액" value={fmtKrw(g.vat_krw)} />
                  <Stat label="합계" value={fmtKrw(g.total_krw)} bold />
                  <Stat label="중량 합계" value={`${fmtNum(g.total_weight_kg)} kg`} />
                </dl>

                {/* 매출 라인 (라이트) */}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-2 py-1 text-left">매출 / 일자</th>
                        <th className="px-2 py-1 text-left">품목</th>
                        <th className="px-2 py-1 text-right">수량</th>
                        <th className="px-2 py-1 text-right">중량(kg)</th>
                        <th className="px-2 py-1 text-right">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.sales.flatMap((s) =>
                        s.sale_line.map((l) => (
                          <tr key={l.id} className="border-t border-border/40">
                            <td className="px-2 py-1">
                              <Link
                                href={`/${bookParam}/sales/${s.id}`}
                                className="font-mono hover:underline"
                              >
                                {s.doc_no}
                              </Link>
                              <div className="text-[10px] text-muted-foreground">
                                {s.ordered_on}
                              </div>
                            </td>
                            <td className="px-2 py-1">
                              {l.item?.name ?? "—"}
                              {l.item?.rebar_spec_code ? (
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  {l.item.rebar_spec_code} {l.item.rebar_grade_code}{" "}
                                  {l.item.length_m ? `${l.item.length_m}M` : ""}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {fmtNum(Number(l.qty))} {l.unit}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {l.theoretical_weight_kg ?? l.weight_kg
                                ? fmtNum(
                                    Number(l.theoretical_weight_kg ?? l.weight_kg),
                                  )
                                : ""}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {l.line_subtotal_krw
                                ? fmtNum(Number(l.line_subtotal_krw))
                                : ""}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>

                {cert ? (
                  <p className="mt-3 rounded bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                    납품확인서 발급됨: <span className="font-mono">{cert.doc_no}</span>{" "}
                    · {cert.issued_on}
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function Meta({
  label,
  value,
  colSpan,
}: {
  label: string;
  value: string;
  colSpan?: boolean;
}) {
  return (
    <div className={colSpan ? "col-span-2 md:col-span-4" : ""}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Stat({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${bold ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

// site + group 데이터 → DeliveryCertForm 의 input 구조로 변환
function buildCertData(
  g: Group,
  site: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    client_name: string | null;
    owner_name: string | null;
    owner_address: string | null;
  },
  cert: DeliveryCertificate | null,
): DeliveryCertData {
  // 단위별 합계 — 섞일 수 있으니 텍스트로
  const qtyByUnit = new Map<string, number>();
  for (const s of g.sales) {
    for (const l of s.sale_line) {
      qtyByUnit.set(l.unit, (qtyByUnit.get(l.unit) ?? 0) + Number(l.qty));
    }
  }
  const qtySummary = Array.from(qtyByUnit.entries())
    .map(([u, q]) => `${fmtNum(q)}${u}`)
    .join(" / ");

  const lines = g.sales.flatMap((s) =>
    s.sale_line.map((l) => ({
      ordered_on: s.ordered_on,
      item_name: l.item?.name ?? "—",
      spec:
        l.item?.category === "rebar" && l.item?.rebar_spec_code
          ? [
              l.item.rebar_spec_code,
              l.item.rebar_grade_code,
              l.item.length_m ? `${l.item.length_m}M` : null,
            ]
              .filter(Boolean)
              .join(" ")
          : "",
      qty: Number(l.qty),
      unit: l.unit,
      weight_kg:
        l.theoretical_weight_kg != null
          ? Number(l.theoretical_weight_kg)
          : l.weight_kg != null
            ? Number(l.weight_kg)
            : null,
      subtotal_krw: l.line_subtotal_krw ? Number(l.line_subtotal_krw) : undefined,
      doc_no: s.doc_no,
    })),
  );

  return {
    cert,
    partner: {
      name: g.partner.name,
      business_no: g.partner.business_no,
      representative: g.partner.representative,
      address: g.partner.address,
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
    total_weight_kg: g.total_weight_kg,
    total_krw: g.total_krw,
    period_from: g.first_ordered_on,
    period_to: g.last_ordered_on,
  };
}
