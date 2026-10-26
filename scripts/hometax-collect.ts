/**
 * 홈택스 계산서 수집(매일) — 팝빌 홈택스 연계로 책별 매출·매입 (세금)계산서를 hometax_invoice 에 쌓는다.
 *   npx tsx scripts/hometax-collect.ts                       # 전송일 기준 최근 7일, HOMETAX_BOOKS(기본 sl)
 *   npx tsx scripts/hometax-collect.ts --from 2026-05-01 --to 2026-10-26 --dtype W --book sl   # 소급(작성일 기준)
 *
 * env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POPBILL_LINK_ID, POPBILL_SECRET_KEY, POPBILL_IS_TEST(운영은 false),
 *      HOMETAX_BOOKS(쉼표, 기본 "sl"), KAKAOWORK_WEBHOOK_URL(선택 — 수집 요약 알림)
 * GitHub Actions 매일 06:00 KST 실행(.github/workflows/hometax-collect.yml).
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { collectBothDirections } from "../lib/hometax/collect";
import { recentRange } from "../lib/hometax/normalize";
import type { HometaxDateType } from "../lib/hometax/types";
import { notifyKakaoWork, adminUrl } from "../lib/kakaowork";
import { isValidBook, type Book } from "../lib/book";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const defaults = recentRange(7, today);
  const from = arg("from") ?? defaults.from;
  const to = arg("to") ?? defaults.to;
  const dateType = (arg("dtype") ?? "S").toUpperCase() as HometaxDateType;
  if (!["W", "I", "S"].includes(dateType)) throw new Error("--dtype 은 W/I/S");
  const books = (arg("book") ?? process.env.HOMETAX_BOOKS ?? "sl")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Book => isValidBook(s) && s !== "b");
  if (books.length === 0) throw new Error("수집할 책이 없습니다(HOMETAX_BOOKS / --book: bk, sl)");

  console.log(`홈택스 수집 — 책 ${books.join(",")} · ${dateType} ${from}~${to} · ${process.env.POPBILL_IS_TEST === "false" ? "운영" : "테스트베드"}`);
  const lines: string[] = [];
  let failed = 0;
  let newTotal = 0;
  for (const book of books) {
    const r = await collectBothDirections(sb, { book, dateType, from, to, source: "cron", log: (m) => console.log(m) });
    for (const dir of ["sell", "buy"] as const) {
      const x = r[dir];
      if (x.ok) {
        newTotal += x.inserted;
        lines.push(`${book}/${dir === "sell" ? "매출" : "매입"}: ${x.found}건 (신규 ${x.inserted})`);
      } else {
        failed++;
        lines.push(`${book}/${dir === "sell" ? "매출" : "매입"}: 실패 — ${x.error}`);
        console.error(`  실패: ${x.error}`);
      }
    }
  }
  // 알림: 새 건이 있거나 실패가 있을 때만
  if (newTotal > 0 || failed > 0) {
    await notifyKakaoWork([`🧾 홈택스 수집 ${to}`, ...lines, adminUrl(`/${books[0]}/hometax`)].join("\n"));
  }
  if (failed > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
