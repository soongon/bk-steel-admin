import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type BookView } from "@/lib/book";
import { fmtKstDateTime, formatPhone, kstToday } from "@/lib/format";
import { canWriteInquiries, listInquiries } from "@/lib/homepage-inquiry";
import {
  INQUIRY_KIND_CLS,
  INQUIRY_STATUSES,
  type Inquiry,
  type InquiryStatus,
  describeSource,
  guessLeadSource,
  inquiryKind,
  inquiryKindLabel,
  inquiryStatusMeta,
  isInquiryStatus,
  isPhoneInquiry,
  phoneKey,
} from "@/lib/inquiry";
import { LeadSourceBadge } from "@/components/admin/lead-source-badge";
import { NoteLogBadge } from "@/components/admin/note-cell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { InquiryUnavailable } from "./inquiry-unavailable";
import { InquiryDeleteButton } from "./inquiry-delete-button";
import { InquiryQuickStatus } from "./inquiry-quick-status";
import { InquiryRow } from "./inquiry-row";
import { InquiryStatusPill, StatusDot } from "./inquiry-status-pill";
import { PhoneInquiryButton } from "./phone-inquiry-dialog";

/**
 * 문의 목록 — 홈페이지 전용 Supabase 의 inquiries 를 그대로 읽는다(책과 무관한 공유 영역).
 * 홈페이지 폼 문의 + 여기서 직접 입력한 전화 문의(source.channel = 'phone')가 한 목록에 섞인다.
 * 상태는 홈페이지 관리자와 같은 값이라 어느 쪽에서 바꿔도 같이 바뀐다.
 * 기본(한눈에)은 새 문의(바로 [진행 시작]) · 진행중(중심, 오래된 순·최근 메모) · 완료(접어 둠) 세 칸,
 * 상태 칩을 누르면 그 상태만 한 표로.
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

  const [res, canWrite, partnersRes, memosRes] = await Promise.all([
    listInquiries(),
    canWriteInquiries(),
    // 같은 번호의 거래처를 이름 옆에 표시 — 거래처 전화는 숫자만 저장된다.
    supabase.from("partner").select("name, phone").is("deleted_at", null).not("phone", "is", null),
    // 메모 기록(0098, 어드민 DB) 건수·최근 1건 — 문의가 다른 DB 라 embed 못 해 통째로 읽어 묶는다(문의 수십 건 규모).
    supabase.from("inquiry_memo").select("inquiry_id, body, created_at").order("created_at", { ascending: false }).limit(5000),
  ]);
  if (!res.ok) return <InquiryUnavailable error={res.error} unconfigured={res.unconfigured} />;

  const partnerByPhone = new Map<string, string>();
  for (const p of (partnersRes.data ?? []) as Array<{ name: string; phone: string | null }>) {
    const k = phoneKey(p.phone);
    if (k && !partnerByPhone.has(k)) partnerByPhone.set(k, p.name);
  }

  // 최신순으로 읽었으니 문의별 첫 행이 최근 메모.
  const memoLog = new Map<string, { count: number; latest: { body: string; created_at: string } }>();
  for (const m of (memosRes.data ?? []) as Array<{ inquiry_id: string; body: string; created_at: string }>) {
    const cur = memoLog.get(m.inquiry_id);
    if (cur) cur.count += 1;
    else memoLog.set(m.inquiry_id, { count: 1, latest: { body: m.body, created_at: m.created_at } });
  }

  const all = res.data;
  const counts: Record<string, number> = {};
  for (const i of all) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const chips: Array<{ key: InquiryStatus | null; label: string; count: number }> = [
    { key: null, label: "한눈에", count: all.length },
    ...INQUIRY_STATUSES.map((s) => ({ key: s.value, label: s.label, count: counts[s.value] ?? 0 })),
  ];
  const chipCls = (on: boolean) =>
    `inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs ${on ? "bg-foreground text-background" : "bg-background hover:bg-muted"}`;

  const today = Date.parse(kstToday()); // 한국 날짜 기준으로 센다(접수한 날 = 1일째)
  const kindBadge = (i: Inquiry) => {
    const kind = inquiryKind(i.inquiry_type);
    return (
      <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs whitespace-nowrap", kind ? INQUIRY_KIND_CLS[kind] : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300")}>
        {inquiryKindLabel(i.inquiry_type)}
      </span>
    );
  };
  const href = (i: Inquiry) => `/${view}/inquiries/${i.id}`;

  /** 접수 칸 — 날짜는 크게, 시각은 아래 작게. 휴대폰 폭에선 연도를 뺀다. showAge 면 'N일째'(일주일 넘으면 주황). */
  const receivedCell = (i: Inquiry, showAge: boolean) => {
    const received = fmtKstDateTime(i.created_at);
    const days = Math.round((today - Date.parse(received.slice(0, 10))) / 86_400_000);
    return (
      <TableCell className="text-xs tabular-nums">
        <div className="text-base font-semibold">
          <span className="sm:hidden">{received.slice(5, 10)}</span>
          <span className="hidden sm:inline">{received.slice(0, 10)}</span>
        </div>
        <div className="text-muted-foreground">{received.slice(11)}</div>
        {showAge ? (
          <div
            className={cn(
              "mt-0.5 inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold",
              days >= 7 ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" : "bg-muted text-muted-foreground",
            )}
            title="접수한 날부터 센 날수(한국 날짜)"
          >
            {days < 1 ? "오늘 접수" : `${days + 1}일째`}
          </div>
        ) : null}
        {(i.submit_count ?? 1) > 1 ? <div className="text-muted-foreground">{i.submit_count}회 제출</div> : null}
      </TableCell>
    );
  };

  /** 이름 칸 — 구분(휴대폰)·전화·메모·거래처 표시 + 현장. showMemo 면 최근 메모 한 줄을 보이게(진행 상황). */
  const nameCell = (i: Inquiry, showMemo: boolean) => {
    const partner = partnerByPhone.get(phoneKey(i.phone));
    const memo = memoLog.get(i.id);
    return (
      <TableCell className="min-w-[9rem] whitespace-normal">
        <span className="mr-1.5 sm:hidden">{kindBadge(i)}</span>
        <Link href={href(i)} className="font-medium hover:underline">
          {i.name}
        </Link>
        {isPhoneInquiry(i.source) ? (
          <span className="ml-1.5 inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] text-muted-foreground" title="전화로 받아 직접 입력한 문의">
            전화
          </span>
        ) : null}
        {memo ? (
          <span className="ml-1.5 inline-flex align-middle">
            <NoteLogBadge count={memo.count} latest={memo.latest} />
          </span>
        ) : null}
        {partner ? (
          <span className="ml-1.5 inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] text-muted-foreground" title="같은 번호로 등록된 거래처">
            거래처 {partner}
          </span>
        ) : null}
        {i.location ? <div className="text-xs text-muted-foreground">{i.location}</div> : null}
        {showMemo ? (
          memo ? (
            <p className="mt-1 line-clamp-1 max-w-md text-xs text-foreground/80" title={memo.latest.body}>
              <span className="mr-1 text-muted-foreground">{fmtKstDateTime(memo.latest.created_at).slice(5, 10)}</span>
              {memo.latest.body}
            </p>
          ) : (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">메모 없음 — 진행 상황을 남겨 두세요</p>
          )
        ) : null}
      </TableCell>
    );
  };

  const phoneCell = (i: Inquiry) => (
    <TableCell className="hidden text-xs tabular-nums whitespace-nowrap sm:table-cell">
      <a href={`tel:${phoneKey(i.phone)}`} className="hover:underline">
        {formatPhone(i.phone) || i.phone}
      </a>
    </TableCell>
  );
  const messageCell = (i: Inquiry) => (
    <TableCell className="hidden lg:table-cell">
      <p className="line-clamp-2 max-w-xs text-xs whitespace-pre-line text-muted-foreground xl:max-w-md">{i.message || "—"}</p>
    </TableCell>
  );
  const leadCell = (i: Inquiry) => {
    const srcText = describeSource(i.source);
    return (
      <TableCell className="hidden xl:table-cell">
        {/* 전화 문의는 이름 옆 '전화' 표시 — 여기엔 고른 유입경로만(안 골랐으면 미기록) */}
        <LeadSourceBadge source={guessLeadSource(i.source)} />
        {srcText ? <div className="mt-0.5 max-w-[8rem] truncate text-[10px] text-muted-foreground" title={srcText}>{srcText}</div> : null}
      </TableCell>
    );
  };
  const deleteCell = (i: Inquiry) =>
    canWrite ? (
      <TableCell className="text-center">
        <InquiryDeleteButton id={i.id} label={`${fmtKstDateTime(i.created_at).slice(0, 10)} ${i.name}`} />
      </TableCell>
    ) : null;

  // ── 상태 하나만 볼 때(칩) — 예전처럼 한 표, 최신순 ──
  if (statusFilter) {
    const rows = all.filter((i) => i.status === statusFilter);
    return (
      <Shell chips={chips} chipCls={chipCls} statusFilter={statusFilter} view={view} canWrite={canWrite}>
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
                <TableHead className="w-24 text-center">상태</TableHead>
                {canWrite ? <TableHead className="w-10" aria-label="삭제" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 8 : 7} className="py-12 text-center text-muted-foreground">
                    &apos;{inquiryStatusMeta(statusFilter).label}&apos; 문의가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((i) => (
                  <InquiryRow key={i.id} href={href(i)} className={cn(i.status === "new" && "bg-red-50/50 dark:bg-red-950/15")}>
                    {receivedCell(i, i.status !== "resolved")}
                    <TableCell className="hidden sm:table-cell">{kindBadge(i)}</TableCell>
                    {nameCell(i, i.status === "read")}
                    {phoneCell(i)}
                    {messageCell(i)}
                    {leadCell(i)}
                    <TableCell className="text-center">
                      <InquiryStatusPill status={i.status} />
                    </TableCell>
                    {deleteCell(i)}
                  </InquiryRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Shell>
    );
  }

  // ── 한눈에(기본) — 새 문의(바로 진행 시작) · 진행중(중심, 오래된 순) · 완료(접어 둠) ──
  const byOldest = (a: Inquiry, b: Inquiry) => a.created_at.localeCompare(b.created_at);
  const fresh = all.filter((i) => i.status === "new").sort(byOldest);
  const working = all.filter((i) => i.status === "read").sort(byOldest);
  const resolved = all.filter((i) => i.status === "resolved"); // 최신순 그대로
  const resolvedShown = resolved.slice(0, RESOLVED_PREVIEW);

  return (
    <Shell chips={chips} chipCls={chipCls} statusFilter={null} view={view} canWrite={canWrite}>
      {/* 새 문의 — 받자마자 진행중으로 넘기는 칸. 없으면 숨긴다. */}
      {fresh.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-red-300 bg-red-50/60 shadow-sm shadow-red-600/10 dark:border-red-900 dark:bg-red-950/20">
          <div className="flex items-center gap-2 border-b border-red-200 px-4 py-2.5 dark:border-red-900">
            <StatusDot status="new" />
            <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">새로 들어온 문의</h2>
            <span className="rounded-full bg-red-600 px-2 text-xs font-semibold text-white tabular-nums">{fresh.length}</span>
            <span className="ml-auto hidden text-xs text-red-700/80 sm:inline dark:text-red-300/80">열어 보거나 [진행 시작]을 누르면 진행중으로 넘어갑니다</span>
          </div>
          <div className="overflow-x-auto">
            <Table className="table-fixed">
              <SectionHeader canWrite={canWrite} nameLabel="이름 / 현장·지역" />
              <TableBody>
                {fresh.map((i) => (
                  <InquiryRow key={i.id} href={href(i)} className="hover:bg-red-100/50 dark:hover:bg-red-950/30">
                    {receivedCell(i, true)}
                    <TableCell className="hidden sm:table-cell">{kindBadge(i)}</TableCell>
                    {nameCell(i, false)}
                    {phoneCell(i)}
                    {messageCell(i)}
                    {leadCell(i)}
                    <TableCell className="text-right">
                      {canWrite ? <InquiryQuickStatus id={i.id} to="read" /> : <InquiryStatusPill status={i.status} />}
                    </TableCell>
                    {deleteCell(i)}
                  </InquiryRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {/* 진행중 — 화면의 중심. 오래된 것부터, 최근 메모 한 줄로 어디까지 했는지 */}
      <section className="overflow-hidden rounded-xl border border-sky-300 bg-card shadow-sm dark:border-sky-900">
        <div className="flex items-center gap-2 border-b bg-sky-50 px-4 py-2.5 dark:bg-sky-950/30">
          <StatusDot status="read" />
          <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-200">진행중</h2>
          <span className="rounded-full bg-sky-600 px-2 text-xs font-semibold text-white tabular-nums">{working.length}</span>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">오래된 순 · 끝나면 [완료]</span>
        </div>
        <div className="overflow-x-auto">
          <Table className="table-fixed">
            <SectionHeader canWrite={canWrite} nameLabel="이름 / 최근 메모" />
            <TableBody>
              {working.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 8 : 7} className="py-10 text-center text-muted-foreground">
                    진행중인 문의가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                working.map((i) => (
                  <InquiryRow key={i.id} href={href(i)}>
                    {receivedCell(i, true)}
                    <TableCell className="hidden sm:table-cell">{kindBadge(i)}</TableCell>
                    {nameCell(i, true)}
                    {phoneCell(i)}
                    {messageCell(i)}
                    {leadCell(i)}
                    <TableCell className="text-right">
                      {canWrite ? <InquiryQuickStatus id={i.id} to="resolved" /> : <InquiryStatusPill status={i.status} />}
                    </TableCell>
                    {deleteCell(i)}
                  </InquiryRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* 완료 — 가볍게. 접어 두고 최근 몇 건만, 나머지는 '완료' 칩에서 */}
      {resolved.length > 0 ? (
        <details className="group rounded-xl border bg-muted/30">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" aria-hidden />
            <StatusDot status="resolved" />
            <span className="font-medium">완료</span>
            <span className="tabular-nums">{resolved.length}</span>
            <span className="ml-auto text-xs group-open:hidden">펼쳐 보기</span>
            {resolved.length > RESOLVED_PREVIEW ? <span className="ml-auto hidden text-xs group-open:inline">최근 {RESOLVED_PREVIEW}건</span> : null}
          </summary>
          <ul className="divide-y border-t text-sm">
            {resolvedShown.map((i) => {
              const memo = memoLog.get(i.id);
              return (
                <li key={i.id}>
                  <Link href={href(i)} className="flex items-center gap-3 px-4 py-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                    <span className="w-20 shrink-0 text-xs tabular-nums">{fmtKstDateTime(i.created_at).slice(0, 10)}</span>
                    <span className="hidden shrink-0 opacity-80 sm:inline">{kindBadge(i)}</span>
                    <span className="shrink-0 font-medium">{i.name}</span>
                    {i.location ? <span className="hidden truncate text-xs md:inline">{i.location}</span> : null}
                    {memo ? <span className="ml-auto hidden max-w-xs truncate text-xs lg:inline">{memo.latest.body}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          {resolved.length > RESOLVED_PREVIEW ? (
            <Link href={`/${view}/inquiries?status=resolved`} className="block border-t px-4 py-2 text-center text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground">
              완료 {resolved.length}건 모두 보기 →
            </Link>
          ) : null}
        </details>
      ) : null}
    </Shell>
  );
}

const RESOLVED_PREVIEW = 10;

/** 새 문의·진행중 칸 공용 머리줄 — table-fixed 와 같이 써서 두 표의 열을 맞춘다(마지막 칸 = 다음 상태 버튼). */
function SectionHeader({ canWrite, nameLabel }: { canWrite: boolean; nameLabel: string }) {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="w-[4.5rem] sm:w-36">접수</TableHead>
        <TableHead className="hidden w-16 sm:table-cell">구분</TableHead>
        <TableHead>{nameLabel}</TableHead>
        <TableHead className="hidden w-36 sm:table-cell">연락처</TableHead>
        <TableHead className="hidden lg:table-cell">내용</TableHead>
        <TableHead className="hidden w-32 xl:table-cell">유입</TableHead>
        <TableHead className="w-24 text-right sm:w-28">{canWrite ? "" : "상태"}</TableHead>
        {canWrite ? <TableHead className="w-8 sm:w-10" aria-label="삭제" /> : null}
      </TableRow>
    </TableHeader>
  );
}

/** 머리말 + 상태 칩 + [문의 입력] — 한눈에·상태별 보기 공용. */
function Shell({
  chips,
  chipCls,
  statusFilter,
  view,
  canWrite,
  children,
}: {
  chips: Array<{ key: InquiryStatus | null; label: string; count: number }>;
  chipCls: (on: boolean) => string;
  statusFilter: InquiryStatus | null;
  view: BookView;
  canWrite: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">문의 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          sl-steel.co.kr 문의 폼 + 직접 입력한 전화 문의 · 책과 무관 · 상태는 홈페이지 관리자와 같이 바뀝니다
        </p>
      </header>

      {/* 상태 칩 + [문의 입력] — 표 바로 위 한 줄 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => {
            const on = c.key === statusFilter;
            return (
              <Link key={c.key ?? "all"} href={c.key ? `/${view}/inquiries?status=${c.key}` : `/${view}/inquiries`} className={chipCls(on)}>
                {c.key ? <StatusDot status={c.key} onSolid={on} /> : null}
                {c.label}
                <span className={`tabular-nums ${on ? "opacity-80" : "text-muted-foreground"}`}>{c.count}</span>
              </Link>
            );
          })}
        </div>
        {canWrite ? <PhoneInquiryButton view={view} /> : null}
      </div>

      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
