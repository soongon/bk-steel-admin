import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { type BookView } from "@/lib/book";
import { fmtKstDateTime, formatPhone } from "@/lib/format";
import { listInquiries } from "@/lib/homepage-inquiry";
import {
  INQUIRY_KIND_CLS,
  INQUIRY_STATUSES,
  type InquiryStatus,
  describeSource,
  guessLeadSource,
  inquiryKind,
  inquiryKindLabel,
  inquiryStatusMeta,
  isInquiryStatus,
  phoneKey,
} from "@/lib/inquiry";
import { LeadSourceBadge } from "@/components/admin/lead-source-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { InquiryUnavailable } from "./inquiry-unavailable";

/**
 * 홈페이지 문의 목록 — 홈페이지 전용 Supabase 의 inquiries 를 그대로 읽는다(책과 무관한 공유 영역).
 * 상태는 홈페이지 관리자와 같은 값이라 어느 쪽에서 바꿔도 같이 바뀐다.
 */
export default async function InquiriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ book: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { book } = await params;
  const { status: statusParam } = await searchParams;
  const view = book as BookView;
  const statusFilter: InquiryStatus | null = isInquiryStatus(statusParam) ? statusParam : null;
  const supabase = await createClient();

  const [res, partnersRes] = await Promise.all([
    listInquiries(),
    // 같은 번호의 거래처를 이름 옆에 표시 — 거래처 전화는 숫자만 저장된다.
    supabase.from("partner").select("name, phone").is("deleted_at", null).not("phone", "is", null),
  ]);
  if (!res.ok) return <InquiryUnavailable error={res.error} unconfigured={res.unconfigured} />;

  const partnerByPhone = new Map<string, string>();
  for (const p of (partnersRes.data ?? []) as Array<{ name: string; phone: string | null }>) {
    const k = phoneKey(p.phone);
    if (k && !partnerByPhone.has(k)) partnerByPhone.set(k, p.name);
  }

  const all = res.data;
  const counts: Record<string, number> = {};
  for (const i of all) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const rows = statusFilter ? all.filter((i) => i.status === statusFilter) : all;
  const chips: Array<{ key: InquiryStatus | null; label: string; count: number }> = [
    { key: null, label: "전체", count: all.length },
    ...INQUIRY_STATUSES.map((s) => ({ key: s.value, label: s.label, count: counts[s.value] ?? 0 })),
  ];
  const chipCls = (on: boolean) =>
    `inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs ${on ? "bg-foreground text-background" : "bg-background hover:bg-muted"}`;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">홈페이지 문의</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          sl-steel.co.kr 문의 폼으로 들어온 문의 · 책과 무관 · 상태는 홈페이지 관리자와 같이 바뀝니다
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const on = c.key === statusFilter;
          return (
            <Link key={c.key ?? "all"} href={c.key ? `/${view}/inquiries?status=${c.key}` : `/${view}/inquiries`} className={chipCls(on)}>
              {c.label}
              <span className={`tabular-nums ${on ? "opacity-80" : "text-muted-foreground"}`}>{c.count}</span>
            </Link>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 sm:w-36">접수</TableHead>
              <TableHead className="hidden w-16 sm:table-cell">구분</TableHead>
              <TableHead>이름 / 현장·지역</TableHead>
              <TableHead className="hidden w-36 sm:table-cell">연락처</TableHead>
              <TableHead className="hidden lg:table-cell">내용</TableHead>
              <TableHead className="hidden w-32 xl:table-cell">유입</TableHead>
              <TableHead className="w-20 text-center">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  {statusFilter ? `'${inquiryStatusMeta(statusFilter).label}' 문의가 없습니다.` : "들어온 문의가 없습니다."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((i) => {
                const kind = inquiryKind(i.inquiry_type);
                const st = inquiryStatusMeta(i.status);
                const partner = partnerByPhone.get(phoneKey(i.phone));
                const lead = guessLeadSource(i.source);
                const srcText = describeSource(i.source);
                const received = fmtKstDateTime(i.created_at);
                const kindBadge = (
                  <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs whitespace-nowrap", kind ? INQUIRY_KIND_CLS[kind] : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300")}>
                    {inquiryKindLabel(i.inquiry_type)}
                  </span>
                );
                return (
                  <TableRow key={i.id} className={cn(i.status === "new" && "bg-red-50/50 dark:bg-red-950/15")}>
                    <TableCell className="text-xs tabular-nums">
                      {/* 휴대폰 폭에선 연도를 빼 상태 칸까지 한 화면에 */}
                      <div>
                        <span className="sm:hidden">{received.slice(5)}</span>
                        <span className="hidden sm:inline">{received}</span>
                      </div>
                      {(i.submit_count ?? 1) > 1 ? <div className="text-muted-foreground">{i.submit_count}회 제출</div> : null}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{kindBadge}</TableCell>
                    <TableCell className="min-w-[9rem] whitespace-normal">
                      <span className="mr-1.5 sm:hidden">{kindBadge}</span>
                      <Link href={`/${view}/inquiries/${i.id}`} className="font-medium hover:underline">
                        {i.name}
                      </Link>
                      {partner ? (
                        <span className="ml-1.5 inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] text-muted-foreground" title="같은 번호로 등록된 거래처">
                          거래처 {partner}
                        </span>
                      ) : null}
                      {i.location ? <div className="text-xs text-muted-foreground">{i.location}</div> : null}
                    </TableCell>
                    <TableCell className="hidden text-xs tabular-nums whitespace-nowrap sm:table-cell">
                      <a href={`tel:${phoneKey(i.phone)}`} className="hover:underline">
                        {formatPhone(i.phone) || i.phone}
                      </a>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <p className="line-clamp-2 max-w-xs text-xs whitespace-pre-line text-muted-foreground xl:max-w-md">{i.message || "—"}</p>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <LeadSourceBadge source={lead} />
                      {srcText ? <div className="mt-0.5 max-w-[8rem] truncate text-[10px] text-muted-foreground" title={srcText}>{srcText}</div> : null}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs whitespace-nowrap ${st.cls}`}>{st.label}</span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
