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
  const { data: sData } = await supabase
    .from("sale")
    .select("doc_no, book, total_krw, payment_due_on, partner:partner(name)")
    .is("deleted_at", null)
    .not("payment_due_on", "is", null)
    .lt("payment_due_on", today)
    .is("settled_on", null)
    .neq("status", "cancelled")
    .order("payment_due_on");
  // 결제 연체(매입): 결제예정일 지남 + 미지급(paid_on null) + 취소 아님
  const { data: pData } = await supabase
    .from("purchase")
    .select("doc_no, book, total_krw, payment_due_on, partner:partner(name)")
    .is("deleted_at", null)
    .not("payment_due_on", "is", null)
    .lt("payment_due_on", today)
    .is("paid_on", null)
    .neq("status", "cancelled")
    .order("payment_due_on");

  const sales = (sData ?? []) as Record<string, any>[];
  const purchases = (pData ?? []) as Record<string, any>[];
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
