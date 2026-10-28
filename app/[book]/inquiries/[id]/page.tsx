import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, MessageSquareIcon, PhoneIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type Book, type BookView, BOOKS } from "@/lib/book";
import { type CompanyProfile, fetchCompanyProfile } from "@/lib/company-profile";
import { fetchSiteOptions } from "@/lib/site";
import { STEEL_CUSTOM_ITEM_ID } from "@/lib/transaction-draft";
import { fmtKstDateTime, formatPhone } from "@/lib/format";
import { getInquiry, listInquiries } from "@/lib/homepage-inquiry";
import {
  INQUIRY_KIND_CLS,
  describeSource,
  guessLeadSource,
  inquiryKind,
  inquiryKindLabel,
  inquiryStatusMeta,
  phoneKey,
} from "@/lib/inquiry";
import { LeadSourceBadge } from "@/components/admin/lead-source-badge";
import { buttonVariants } from "@/components/ui/button";
import { type QuoteItem, type QuotePartner, type QuoteRebarSpec, type QuoteSources } from "@/components/admin/quote-dialog";
import { type PurchaseQuoteDefaults, type PurchaseQuoteItemOption, type PurchaseQuoteSources } from "@/components/admin/purchase-quote-dialog";
import { type PartnerPrefill } from "@/app/[book]/partners/partner-form-dialog";
import { cn } from "@/lib/utils";
import { InquiryUnavailable } from "../inquiry-unavailable";
import { InquiryActions, InquiryStatusBadge, InquiryStatusButtons, InquiryStatusProvider } from "./inquiry-actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PartnerRow = QuotePartner & { is_active: boolean };

/**
 * 홈페이지 문의 상세 — 전화·문자 → 견적서(매입이면 매입견적서)·거래처 등록을 이 화면에서 바로.
 * 견적 폼은 문의의 이름·현장·유입경로로 채워 열고, 저장하면 문의를 '확인'으로 바꾼다.
 */
export default async function InquiryDetailPage({ params }: { params: Promise<{ book: string; id: string }> }) {
  const { book, id } = await params;
  const view = book as BookView;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const books: Book[] = view !== "all" ? [view] : [...BOOKS];

  const [res, listRes, partnersRes, itemsRes, rebarSpecsRes, companyRes, pqCompanyList, sites] = await Promise.all([
    getInquiry(id),
    listInquiries(), // 같은 번호의 다른 문의
    supabase
      .from("partner")
      .select("id, code, name, business_no, representative, address, phone, fax, business_type, business_item, is_active")
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("item")
      .select("id, code, name, category, rebar_spec_code, rebar_grade_code, length_m, bars_per_tonne")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase.from("rebar_spec").select("spec_code, unit_weight_kg_per_m, standard_length_m").order("display_order"),
    view !== "all" ? supabase.from("company_profile").select("*").eq("book", view) : supabase.from("company_profile").select("*"),
    // 매입견적서는 B계좌 공급자를 SL 로 채운다(fetchCompanyProfile) — 매입견적서 목록과 같은 공급자로 미리보기.
    Promise.all(books.map((b) => fetchCompanyProfile(supabase, b))),
    fetchSiteOptions(supabase), // 견적 폼 현장명 자동완성(문의의 현장/지역이 기존 현장이면 그대로 연결)
  ]);
  if (!res.ok) return <InquiryUnavailable error={res.error} unconfigured={res.unconfigured} />;
  const inq = res.data;
  if (!inq) notFound();

  const key = phoneKey(inq.phone);
  const allPartners = (partnersRes.data ?? []) as PartnerRow[];
  const matched = key ? allPartners.filter((p) => phoneKey(p.phone) === key) : [];
  const activePartners = allPartners.filter((p) => p.is_active);
  const others = listRes.ok ? listRes.data.filter((o) => o.id !== inq.id && key && phoneKey(o.phone) === key) : [];

  const kind = inquiryKind(inq.inquiry_type);
  const kindLabel = inquiryKindLabel(inq.inquiry_type);
  const lead = guessLeadSource(inq.source);
  const srcText = describeSource(inq.source);
  const received = fmtKstDateTime(inq.created_at);

  // 견적 폼 마스터 — 견적서·매입견적서 목록과 같은 묶음.
  const quoteCompanies: Partial<Record<Book, CompanyProfile>> = {};
  for (const c of (companyRes.data ?? []) as CompanyProfile[]) {
    if (c.book) quoteCompanies[c.book as Book] = c;
  }
  const pqCompanies: Partial<Record<Book, CompanyProfile>> = {};
  books.forEach((b, i) => {
    const c = pqCompanyList[i];
    if (c) pqCompanies[b] = c;
  });
  const items = (itemsRes.data ?? []) as QuoteItem[];
  const quoteSources: QuoteSources = {
    partners: activePartners,
    items,
    rebarSpecs: (rebarSpecsRes.data ?? []) as QuoteRebarSpec[],
    companies: quoteCompanies,
    sites,
  };
  const pqSources: PurchaseQuoteSources = {
    partners: activePartners,
    items: items.filter((i) => i.id !== STEEL_CUSTOM_ITEM_ID).map((i): PurchaseQuoteItemOption => ({ id: i.id, name: i.name })),
    companies: pqCompanies,
  };

  // 같은 번호 거래처가 있으면 그 이름으로(폼이 거래처로 연결), 없으면 문의에 적힌 이름 그대로(미등록 판매자/고객).
  const partnerName = matched.find((p) => p.is_active)?.name ?? inq.name;
  const pqDefaults: PurchaseQuoteDefaults = {
    partner_name: partnerName,
    site_name: inq.location ?? "",
    lead_source: lead,
    lead_note: `홈페이지 문의 ${received.slice(5, 10)}${srcText ? ` · ${srcText}` : ""}`,
    reference: inq.message || null,
  };
  const partnerPrefill: PartnerPrefill = {
    name: inq.name,
    phone: key,
    notes: `홈페이지 ${kindLabel} 문의 ${received.slice(0, 10)}${inq.location ? ` · ${inq.location}` : ""}`,
    from_inquiry_id: inq.id,
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="text-sm text-muted-foreground">
        <Link href={`/${view}/inquiries`} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> 문의 목록
        </Link>
      </div>

      {/* 상태는 누르는 즉시 배지·버튼에 반영(저장은 뒤에서) */}
      <InquiryStatusProvider id={inq.id} status={inq.status}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs", kind ? INQUIRY_KIND_CLS[kind] : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300")}>
                {kindLabel}
              </span>
              <h1 className="text-xl font-semibold">{inq.name}</h1>
              <InquiryStatusBadge />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              홈페이지 {inq.inquiry_type} · 접수 {received}
              {(inq.submit_count ?? 1) > 1 ? ` · ${inq.submit_count}회 제출(합침)` : ""}
            </p>
          </div>
          <InquiryStatusButtons />
        </header>
      </InquiryStatusProvider>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">연락처</div>
              <a href={`tel:${key}`} className="mt-1 inline-block text-lg font-semibold tabular-nums hover:underline">
                {formatPhone(inq.phone) || inq.phone}
              </a>
              <div className="mt-2 flex gap-1.5">
                <a href={`tel:${key}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <PhoneIcon /> 전화
                </a>
                <a href={`sms:${key}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <MessageSquareIcon /> 문자
                </a>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">현장 / 지역</div>
              <div className="mt-1 text-base">{inq.location || "—"}</div>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-xs text-muted-foreground">문의 내용</h2>
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{inq.message || "(내용 없음)"}</p>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-xs text-muted-foreground">이 문의로</h2>
            <div className="mt-2">
              <InquiryActions
                inquiryId={inq.id}
                view={view}
                kind={kind}
                quoteSources={quoteSources}
                pqSources={pqSources}
                pqDefaults={pqDefaults}
                quotePartnerName={partnerName}
                siteName={inq.location ?? ""}
                reference={inq.message || null}
                partnerPrefill={matched.length === 0 ? partnerPrefill : null}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              이름·현장·유입경로를 채워 엽니다. 견적서를 저장하면 이 문의는 &lsquo;확인&rsquo;으로 바뀝니다.
            </p>
          </section>
        </div>

        <aside className="flex flex-col gap-4 text-sm">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-xs text-muted-foreground">거래처 (같은 전화번호)</h2>
            {matched.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {matched.map((p) => (
                  <li key={p.id}>
                    <Link href={`/${view}/partners?q=${encodeURIComponent(p.name)}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">{p.code}</span>
                    {!p.is_active ? <span className="ml-1.5 text-xs text-muted-foreground">(비활성)</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted-foreground">등록된 거래처가 없습니다 — 처음 연락하는 분입니다.</p>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-xs text-muted-foreground">유입</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <LeadSourceBadge source={lead} />
              {srcText ? <span className="text-xs text-muted-foreground">{srcText}</span> : null}
            </div>
            {inq.source?.landing_path ? (
              <p className="mt-1 text-xs break-all text-muted-foreground">처음 본 화면: {inq.source.landing_path}</p>
            ) : null}
            {!inq.source || Object.keys(inq.source).length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">유입 기록 없음(2026-10-16 전 접수)</p>
            ) : null}
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-xs text-muted-foreground">접수 기록</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">알림 메일</dt>
              <dd>{inq.notified_at ? `발송 ${fmtKstDateTime(inq.notified_at)}` : "미발송"}</dd>
              <dt className="text-muted-foreground">제출</dt>
              <dd>{(inq.submit_count ?? 1) > 1 ? `${inq.submit_count}회 (10분 안 재제출 합침)` : "1회"}</dd>
              <dt className="text-muted-foreground">마지막 변경</dt>
              <dd>{fmtKstDateTime(inq.updated_at)}</dd>
            </dl>
          </section>

          {others.length > 0 ? (
            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-xs text-muted-foreground">같은 번호의 다른 문의 {others.length}건</h2>
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {others.map((o) => {
                  const ost = inquiryStatusMeta(o.status);
                  return (
                    <li key={o.id} className="flex items-center gap-1.5">
                      <Link href={`/${view}/inquiries/${o.id}`} className="tabular-nums hover:underline">
                        {fmtKstDateTime(o.created_at)}
                      </Link>
                      <span className="text-muted-foreground">{inquiryKindLabel(o.inquiry_type)}</span>
                      <span className={`inline-flex h-4 items-center rounded-full px-1.5 text-[10px] ${ost.cls}`}>{ost.label}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
