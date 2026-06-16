import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSolapiBalance, getSolapiMessages } from "@/lib/solapi";
import { fmtKrw, formatPhone } from "@/lib/format";

const TYPE_LABEL: Record<string, string> = {
  SMS: "SMS",
  LMS: "LMS",
  MMS: "MMS(이미지)",
};

/**
 * 문자 발송 관리 — 솔라피(CoolSMS) 잔액·발송 내역 모니터링.
 * 잔액·내역은 서버에서 솔라피 API 로 조회(키는 server-only). book 과 무관한 계정 단위 데이터.
 */
export default async function SmsSettingsPage() {
  const [balance, messages] = await Promise.all([
    getSolapiBalance(),
    getSolapiMessages(50),
  ]);

  const sentOk = messages.filter((m) => m.status === "COMPLETE").length;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">문자 발송</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          솔라피(CoolSMS) 잔액·발송 내역 — 명세서·견적 문자 모니터링 (최근 50건)
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
          <StatCard
            label="발송 가능액"
            value={fmtKrw(balance.balance + balance.point)}
            hint="캐시 + 포인트"
          />
          <StatCard
            label="최근 발송"
            value={`${messages.length}건`}
            hint={`성공 ${sentOk} · 실패 ${messages.length - sentOk}`}
          />
        </section>
      )}

      <section className="overflow-x-auto rounded-lg border bg-card">
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
            {messages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  발송 내역이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              messages.map((m, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs tabular-nums">
                    {m.dateCreated.slice(0, 16).replace("T", " ")}
                  </TableCell>
                  <TableCell className="text-xs">{TYPE_LABEL[m.type] ?? m.type}</TableCell>
                  <TableCell className="font-mono text-xs">{formatPhone(m.to)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatPhone(m.from)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} reason={m.reason} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
