// stdin 으로 받은 텍스트를 카카오워크로 보낸다(스케줄 래퍼용). env KAKAOWORK_WEBHOOK_URL 미설정이면 그냥 출력만.
//   echo "메시지" | npx tsx scripts/notify-text.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { notifyKakaoWork } from "../lib/kakaowork";

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return;
  if (!process.env.KAKAOWORK_WEBHOOK_URL) { console.log("[notify-text] KAKAOWORK_WEBHOOK_URL 없음 — 출력만\n" + text); return; }
  await notifyKakaoWork(text.slice(0, 3500));
}
main().catch((e) => { console.error(e); process.exit(1); });
