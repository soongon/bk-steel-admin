import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, FileSearchIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { type Book, type BookView, BOOK_LABEL } from "@/lib/book";
import { fmtKrw, fmtKstDateTime, formatBusinessNo, kstToday } from "@/lib/format";
import { recentRange } from "@/lib/hometax/normalize";
import {
  HOMETAX_DATE_TYPE_LABEL,
  HOMETAX_DIRECTIONS,
  HOMETAX_MATCH_STATUS_LABEL,
  type HometaxDirection,
  type HometaxInvoiceRow,
  type HometaxJobRow,
} from "@/lib/hometax/types";
import { BookBadge } from "@/components/admin/book-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HometaxCollectButton } from "./collect-button";
import { ClassifyButtons } from "./classify-buttons";
import { looksLikeInventory } from "@/lib/hometax/reconcile-buy";

// [지금 수집]은 팝빌 작업 완료를 기다리므로(보통 수십 초) 이 라우트의 서버 액션 상한을 넉넉히.
export const maxDuration = 120;

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m >= 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/**
 * 홈택스 대사 — 팝빌 홈택스 연계로 수집한 (세금)계산서 원장. 1단계: 수집·조회·수집 이력.
 * 매출 대사(§3)·매입 생성(§4) 액션은 2·3단계에서 이 표의 행 액션으로 붙는다. B계좌 책은 대상 아님.
 */
export default async function HometaxPage({
  params,
  searchParams,
}: {
  params: Promise<{ book: string }>;
  searchParams: Promise<{ month?: string; dir?: string }>;
}) {
  const { book } = await params;
  const sp = await searchParams;
  const view = book as BookView;
  const today = kstToday();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const dir: HometaxDirection = sp.dir === "buy" ? "buy" : "sell";
  const books: Book[] = view === "all" ? ["bk", "sl"] : view === "b" ? [] : [view];
  const base = `/${view}/hometax`;
  const href = (m: string, d: HometaxDirection) => `${base}?month=${m}&dir=${d}`;

  if (books.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <h1 className="text-lg font-semibold">홈택스 대사</h1>
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          B계좌는 무자료 거래만 다루므로 홈택스 계산서 수집 대상이 아닙니다. 법인 또는 사업자 책에서 보세요.
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [rowsRes, jobsRes, countsRes] = await Promise.all([
    supabase
      .from("hometax_invoice")
      .select(
        "id, book, direction, nts_confirm_num, kind, tax_type, issue_type, purpose, modify_code, orig_nts_confirm_num, write_date, issue_date, send_date, supplier, invoicee, supply_amount, tax_amount, total_amount, item_summary, items, match_status, sale_id, purchase_id, tax_invoice_id, notes, collected_at",
      )
      .in("book", books)
      .eq("direction", dir)
      .is("deleted_at", null)
      .gte("write_date", `${month}-01`)
      .lt("write_date", nextMonthStart(month))
      .order("write_date", { ascending: false })
      .order("nts_confirm_num", { ascending: false }),
    supabase
      .from("hometax_collection_job")
      .select("id, book, direction, job_id, date_type, from_date, to_date, state, found, inserted, updated, error, source, requested_at, finished_at")
      .in("book", books)
      .order("requested_at", { ascending: false })
      .limit(8),
    // 이 달 반대 방향 건수 — 탭에 숫자를 보여 주기 위해
    supabase
      .from("hometax_invoice")
      .select("direction")
      .in("book", books)
      .is("deleted_at", null)
      .gte("write_date", `${month}-01`)
      .lt("write_date", nextMonthStart(month)),
  ]);
  const rows = (rowsRes.data ?? []) as unknown as HometaxInvoiceRow[];
  const jobs = (jobsRes.data ?? []) as unknown as HometaxJobRow[];
  const dirCounts: Record<HometaxDirection, number> = { sell: 0, buy: 0 };
  for (const r of (countsRes.data ?? []) as Array<{ direction: HometaxDirection }>) dirCounts[r.direction] = (dirCounts[r.direction] ?? 0) + 1;

  // 수정분은 그룹 순합계로(기획 §3.2) — 합계 카드는 전 행 합산(수정분 ± 포함)이라 그대로 순합계가 된다.
  const sum = (k: "supply_amount" | "tax_amount" | "total_amount") => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const statusCounts: Record<string, number> = {};
  for (const r of rows) statusCounts[r.match_status] = (statusCounts[r.match_status] ?? 0) + 1;
  const range = recentRange(7, today);
  const err = rowsRes.error ?? jobsRes.error;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileSearchIcon className="size-5" />
          <h1 className="text-lg font-semibold">홈택스 대사</h1>
          {view !== "all" ? <BookBadge book={view as Book} /> : null}
          <span className="text-xs text-muted-foreground">팝빌 홈택스 연계 수집본 · 작성일 기준</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Link href={href(shiftMonth(month, -1), dir)} className="rounded-md border p-1 hover:bg-muted" aria-label="이전 달">
              <ChevronLeftIcon className="size-4" />
            </Link>
            <span className="min-w-[5.5rem] text-center text-sm font-medium tabular-nums">{month}</span>
            <Link href={href(shiftMonth(month, 1), dir)} className="rounded-md border p-1 hover:bg-muted" aria-label="다음 달">
              <ChevronRightIcon className="size-4" />
            </Link>
          </div>
          <HometaxCollectButton books={books} defaultFrom={range.from} defaultTo={range.to} />
        </div>
      </div>

      {err ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {/relation .*hometax_invoice|schema cache/i.test(err.message)
            ? "hometax_invoice 테이블이 아직 없습니다 — 마이그레이션 0084 를 적용해 주세요."
            : `조회 실패: ${err.message}`}
        </div>
      ) : null}

      {/* 방향 탭 */}
      <div className="flex items-center gap-1.5">
        {HOMETAX_DIRECTIONS.map((d) => {
          const on = d.value === dir;
          return (
            <Link
              key={d.value}
              href={href(month, d.value)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm ${on ? "bg-foreground text-background" : "bg-background hover:bg-muted"}`}
            >
              {d.label}
              <span className={`text-xs tabular-nums ${on ? "opacity-80" : "text-muted-foreground"}`}>{dirCounts[d.value]}</span>
            </Link>
          );
        })}
        <span className="ml-2 text-xs text-muted-foreground">
          {Object.entries(statusCounts)
            .map(([k, n]) => `${HOMETAX_MATCH_STATUS_LABEL[k as keyof typeof HOMETAX_MATCH_STATUS_LABEL]?.label ?? k} ${n}`)
            .join(" · ")}
        </span>
      </div>

      {/* 요약 카드 — 홈택스 합계(순합계). 시스템 합계·차이는 2·3단계에서 추가 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label={`${dir === "sell" ? "매출" : "매입"} 건수`} value={`${rows.length}건`} />
        <Card label="공급가액" value={fmtKrw(sum("supply_amount"))} />
        <Card label="세액" value={fmtKrw(sum("tax_amount"))} />
        <Card label="합계" value={fmtKrw(sum("total_amount"))} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">작성일</TableHead>
              {view === "all" ? <TableHead className="w-16">책</TableHead> : null}
              <TableHead>{dir === "sell" ? "공급받는자" : "공급자"}</TableHead>
              <TableHead>품목</TableHead>
              <TableHead className="w-28 text-right">공급가액</TableHead>
              <TableHead className="w-24 text-right">세액</TableHead>
              <TableHead className="w-28 text-right">합계</TableHead>
              <TableHead className="w-28">구분</TableHead>
              <TableHead className="w-20 text-center">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={view === "all" ? 9 : 8} className="py-12 text-center text-muted-foreground">
                  이 달 수집된 {dir === "sell" ? "매출" : "매입"} 계산서가 없습니다. [지금 수집]으로 가져오거나 다른 달을 보세요.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const party = dir === "sell" ? r.invoicee : r.supplier;
                const st = HOMETAX_MATCH_STATUS_LABEL[r.match_status] ?? { label: r.match_status, cls: "" };
                const isModify = (r.modify_code ?? 0) !== 0;
                return (
                  <TableRow key={r.id} className={isModify ? "bg-amber-50/40 dark:bg-amber-950/10" : undefined}>
                    <TableCell className="text-xs tabular-nums">
                      <div>{r.write_date}</div>
                      {r.send_date ? <div className="text-muted-foreground">전송 {r.send_date.slice(5)}</div> : null}
                    </TableCell>
                    {view === "all" ? (
                      <TableCell>
                        <BookBadge book={r.book} />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <div className="font-medium">{party?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatBusinessNo(party?.biz_no)}
                        {party?.ceo ? ` · ${party.ceo}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{r.item_summary ?? "—"}</div>
                      {r.items && r.items.length > 1 ? <div className="text-muted-foreground">외 {r.items.length - 1}건</div> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtKrw(Number(r.supply_amount))}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtKrw(Number(r.tax_amount))}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtKrw(Number(r.total_amount))}</TableCell>
                    <TableCell className="text-xs">
                      <div>{r.kind === "invoice" ? "계산서" : "세금계산서"}{r.tax_type && r.tax_type !== "과세" ? ` · ${r.tax_type}` : ""}</div>
                      <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                        {r.issue_type && r.issue_type !== "정발행" ? <span>{r.issue_type}</span> : null}
                        {isModify ? (
                          <span className="rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title={r.orig_nts_confirm_num ? `당초 ${r.orig_nts_confirm_num}` : undefined}>
                            수정{r.modify_code && r.modify_code > 0 ? ` ${r.modify_code}` : ""}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${st.cls}`}>{st.label}</span>
                      {dir === "buy" && r.match_status === "candidate" && (r.notes ?? "").startsWith("분류 대기") ? (
                        <div className="mt-1">
                          <ClassifyButtons nts={r.nts_confirm_num} supplierName={r.supplier?.name ?? null} suggestion={looksLikeInventory(r.item_summary) ? "inventory" : "expense"} />
                        </div>
                      ) : null}
                      {r.notes && !(r.notes ?? "").startsWith("분류 대기") ? <div className="mt-0.5 max-w-[12rem] truncate text-[10px] text-muted-foreground" title={r.notes}>{r.notes}</div> : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 수집 이력 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">수집 이력 (최근 8건)</h2>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">아직 수집 기록이 없습니다. 매일 06:00 자동 수집이 돌거나 [지금 수집]을 누르면 여기 남습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card text-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">요청</TableHead>
                  <TableHead className="w-16">책</TableHead>
                  <TableHead className="w-14">방향</TableHead>
                  <TableHead>기간</TableHead>
                  <TableHead className="w-16">출처</TableHead>
                  <TableHead className="w-20">상태</TableHead>
                  <TableHead>결과</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="tabular-nums">{fmtKstDateTime(j.requested_at)}</TableCell>
                    <TableCell>{BOOK_LABEL[j.book]}</TableCell>
                    <TableCell>{j.direction === "sell" ? "매출" : "매입"}</TableCell>
                    <TableCell className="tabular-nums">
                      {HOMETAX_DATE_TYPE_LABEL[j.date_type]} {j.from_date} ~ {j.to_date}
                    </TableCell>
                    <TableCell>{j.source === "cron" ? "자동" : "수동"}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex h-5 items-center rounded-full px-2 ${
                          j.state === "done"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : j.state === "failed"
                              ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
                        }`}
                      >
                        {j.state === "done" ? "완료" : j.state === "failed" ? "실패" : "진행"}
                      </span>
                    </TableCell>
                    <TableCell className={j.error ? "text-destructive" : "text-muted-foreground"}>
                      {j.error ?? (j.state === "done" ? `${j.found ?? 0}건 · 신규 ${j.inserted ?? 0} · 갱신 ${j.updated ?? 0}` : "—")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
