/**
 * 연체 알림(매일) — 미수(매출)·미지급(매입) 연체 현황을 카카오워크로 요약 전송.
 *   npx tsx scripts/notify-overdue.ts
 *
 * env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KAKAOWORK_WEBHOOK_URL, APP_BASE_URL(선택)
 * 연체 0건이면 전송하지 않는다. (GitHub Actions 매일 cron 으로 실행)
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { notifyKakaoWork, adminUrl, fmtWon } from "../lib/kakaowork";

const BOOK_KO: Record<string, string> = { bk: "법인", sl: "사업자", b: "B계좌" };

function dplus(due: string, today: string): number {
  return Math.round((new Date(today).getTime() - new Date(due).getTime()) / 86_400_000);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }); // KST 'YYYY-MM-DD'

  // 미수 연체(매출): 수금예정일 지남 + 미수금(settled_on null) + 취소 아님
  const { data: sData, error: sErr } = await supabase
    .from("sale")
    .select("id, doc_no, book, total_krw, payment_due_on, partner:partner(name)")
    .is("deleted_at", null)
    .not("payment_due_on", "is", null)
    .lt("payment_due_on", today)
    .is("settled_on", null)
    .neq("status", "cancelled")
    .order("payment_due_on");
  // 결제 연체(매입): 결제예정일 지남 + 미지급(paid_on null). 매입 상태(purchase_status)엔 '취소'가 없다 —
  // 예전 .neq("status","cancelled") 는 enum 오류(22P02)로 조회 자체가 실패해 매입 연체가 한 번도 안 나갔다.
  const { data: pData, error: pErr } = await supabase
    .from("purchase")
    .select("id, doc_no, book, total_krw, payment_due_on, partner:partner(name)")
    .is("deleted_at", null)
    .not("payment_due_on", "is", null)
    .lt("payment_due_on", today)
    .is("paid_on", null)
    .order("payment_due_on");
  if (sErr || pErr) {
    // 한쪽이 실패하면 반쪽 알림이 '연체 없음'처럼 보이지 않게 — 실패로 끝낸다(cron 로그에 남음).
    throw new Error(`연체 조회 실패 — ${[sErr && `매출: ${sErr.message}`, pErr && `매입: ${pErr.message}`].filter(Boolean).join(" / ")}`);
  }

  // 이미 들어온 입금(지운 매출에서 옮겨 온 수금 등)은 빼고 남은 미수만 — 다 받은 매출은 알리지 않는다.
  const overdueSales = (sData ?? []) as Record<string, any>[];
  const received = new Map<string, number>();
  for (let i = 0; i < overdueSales.length; i += 100) {
    const { data } = await supabase
      .from("bank_transaction")
      .select("sale_id, amount_krw")
      .in("sale_id", overdueSales.slice(i, i + 100).map((r) => r.id))
      .is("deleted_at", null)
      .gt("amount_krw", 0);
    for (const r of (data ?? []) as Array<{ sale_id: string; amount_krw: number }>) {
      received.set(r.sale_id, (received.get(r.sale_id) ?? 0) + Number(r.amount_krw));
    }
  }
  const sales = overdueSales
    .map((r) => ({ ...r, total_krw: Number(r.total_krw) - (received.get(r.id) ?? 0) }))
    .filter((r) => r.total_krw > 0);
  // 이미 나간 출금(지운 매입에서 옮겨 온 결제 등)은 빼고 남은 미지급만 — 다 낸 매입은 알리지 않는다.
  const overduePurchases = (pData ?? []) as Record<string, any>[];
  const paid = new Map<string, number>();
  for (let i = 0; i < overduePurchases.length; i += 100) {
    const { data } = await supabase
      .from("bank_transaction")
      .select("purchase_id, amount_krw")
      .in("purchase_id", overduePurchases.slice(i, i + 100).map((r) => r.id))
      .is("deleted_at", null)
      .lt("amount_krw", 0);
    for (const r of (data ?? []) as Array<{ purchase_id: string; amount_krw: number }>) {
      paid.set(r.purchase_id, (paid.get(r.purchase_id) ?? 0) - Number(r.amount_krw));
    }
  }
  const purchases = overduePurchases
    .map((r) => ({ ...r, total_krw: Number(r.total_krw) - (paid.get(r.id) ?? 0) }))
    .filter((r) => r.total_krw > 0);
  if (sales.length === 0 && purchases.length === 0) {
    console.log("연체 없음 — 알림 생략");
    return;
  }

  const sum = (rows: Record<string, any>[]) => rows.reduce((a, r) => a + Number(r.total_krw || 0), 0);
  const line = (r: Record<string, any>, kind: string) =>
    `· ${kind} ${r.doc_no} ${BOOK_KO[r.book] ?? r.book} ${r.partner?.name ?? "—"} ${fmtWon(r.total_krw)} (D+${dplus(r.payment_due_on, today)})`;

  const parts: string[] = [`⏰ 연체 현황 (${today.slice(5)})`];
  if (sales.length) parts.push(`미수(매출): ${sales.length}건 · ${fmtWon(sum(sales))}`);
  if (purchases.length) parts.push(`미지급(매입): ${purchases.length}건 · ${fmtWon(sum(purchases))}`);
  parts.push("");
  parts.push("[오래된 순 · 최대 5건]");
  for (const r of sales.slice(0, 5)) parts.push(line(r, "매출"));
  for (const r of purchases.slice(0, 5)) parts.push(line(r, "매입"));
  parts.push(adminUrl("/all/receivables"));

  await notifyKakaoWork(parts.join("\n"));
  console.log(`연체 알림 전송 — 미수 ${sales.length}건 / 미지급 ${purchases.length}건`);
}

main().catch((e) => {
  console.error("실패:", e?.message ?? e);
  process.exit(1);
});
