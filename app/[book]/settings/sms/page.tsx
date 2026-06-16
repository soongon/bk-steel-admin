import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BookBadge } from "@/components/admin/book-badge";
import { type Book } from "@/lib/book";
import { createClient } from "@/lib/supabase/server";
import { getSolapiBalance, getSolapiMessages } from "@/lib/solapi";
import { fmtKrw, formatPhone } from "@/lib/format";

const TYPE_LABEL: Record<string, string> = { SMS: "SMS", LMS: "LMS", MMS: "MMS(이미지)" };

type SmsSale = {
  id: string;
  book: Book;
  doc_no: string;
  statement_sms_sent_on: string | null;
  site_name: string | null;
  partner: { name: string } | null;
};

/**
 * 문자 발송 관리 — 솔라피(CoolSMS) 잔액·발송내역·통계 + 매출 연결(명세서 전송 이력).
 * 솔라피 데이터는 계정 단위(book 무관), 매출 연결은 전체 book 의 sale.statement_sms_sent_on.
 */
export default async function SmsSettingsPage() {
  const supabase = await createClient();
  const [balance, messages, salesRes] = await Promise.all([
    getSolapiBalance(),
    getSolapiMessages(200),
    supabase
      .from("sale")
      .select("id, book, doc_no, statement_sms_sent_on, site_name, partner:partner(name)")
      .not("statement_sms_sent_on", "is", null)
      .order("statement_sms_sent_on", { ascending: false })
      .limit(50),
  ]);

  const smsSales = (salesRes.data as unknown as SmsSale[]) ?? [];
  const recent = messages.slice(0, 50);

  // 통계 집계 (최근 200건 기준)
  const total = messages.length;
  const ok = messages.filter((m) => m.status === "COMPLETE").length;
  const byType: Record<string, number> = { SMS: 0, LMS: 0, MMS: 0 };
  for (const m of messages) if (m.type in byType) byType[m.type]++;
  const byDay = new Map<string, number>();
  for (const m of messages) {
    const d = m.dateCreated.slice(0, 10);
    if (d) byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  const maxDay = Math.max(1, ...days.map(([, n]) => n));

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">문자 발송</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          솔라피(CoolSMS) 잔액·발송 내역·통계 + 거래처 명세서 전송 이력
        </p>
      </header>

      {balance === null ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          솔라피 키가 설정되지 않았거나 조회에 실패했습니다. <code>SOLAPI_API_KEY</code>·
          <code>SOLAPI_API_SECRET</code> 을 확인하세요.
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="캐시 잔액" value={fmtKrw(balance.balance)} />
          <StatCard label="포인트" value={fmtKrw(balance.point)} />
          <StatCard label="발송 가능액" value={fmtKrw(balance.balance + balance.point)} hint="캐시 + 포인트" />
          <StatCard
            label="성공률"
            value={total ? `${Math.round((ok / total) * 100)}%` : "—"}
            hint={`최근 ${total}건 · 성공 ${ok} / 실패 ${total - ok}`}
          />
        </section>
      )}

      {/* 통계 — 유형별 + 일별 */}
      {total > 0 ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">유형별 (최근 {total}건)</h2>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span>SMS <b className="tabular-nums">{byType.SMS}</b></span>
              <span>LMS <b className="tabular-nums">{byType.LMS}</b></span>
              <span>MMS <b className="tabular-nums">{byType.MMS}</b></span>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">일별 발송 (최근 7일)</h2>
            {days.length === 0 ? (
              <p className="text-xs text-muted-foreground">데이터 없음</p>
            ) : (
              <div className="space-y-1.5">
                {days.map(([d, n]) => (
                  <div key={d} className="flex items-center gap-2 text-xs">
                    <span className="w-12 tabular-nums text-muted-foreground">{d.slice(5)}</span>
                    <div className="h-3 rounded bg-primary/70" style={{ width: `${(n / maxDay) * 100}%`, minWidth: "4px" }} />
                    <span className="tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* 매출 연결 — 거래처별 명세서 문자 전송 이력 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">명세서 문자 전송 이력 (매출 연결)</h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">전송일</TableHead>
                <TableHead className="w-20">책</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead className="w-32">문서</TableHead>
                <TableHead>현장</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {smsSales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    명세서 문자 전송 이력이 없습니다 (발송 성공 시 자동 기록됩니다).
                  </TableCell>
                </TableRow>
              ) : (
                smsSales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs tabular-nums">{s.statement_sms_sent_on}</TableCell>
                    <TableCell><BookBadge book={s.book} /></TableCell>
                    <TableCell className="text-sm">{s.partner?.name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/${s.book}/sales/${s.id}`} className="hover:underline">
                        {s.doc_no}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.site_name ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* 발송 내역 (솔라피) */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">발송 내역 (최근 {recent.length}건)</h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">일시</TableHead>
                <TableHead className="w-24">유형</TableHead>
                <TableHead className="w-36">수신</TableHead>
                <TableHead className="w-36">발신</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    발송 내역이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                recent.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs tabular-nums">
                      {m.dateCreated.slice(0, 16).replace("T", " ")}
                    </TableCell>
                    <TableCell className="text-xs">{TYPE_LABEL[m.type] ?? m.type}</TableCell>
                    <TableCell className="font-mono text-xs">{formatPhone(m.to)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{formatPhone(m.from)}</TableCell>
                    <TableCell><StatusBadge status={m.status} reason={m.reason} /></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function StatusBadge({ status, reason }: { status: string; reason: string }) {
  const ok = status === "COMPLETE";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${
          ok
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
            : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
        }`}
      >
        {ok ? "성공" : "실패"}
      </span>
      {!ok && reason ? <span className="text-xs text-muted-foreground">{reason}</span> : null}
    </span>
  );
}
