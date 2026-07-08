/**
 * 오래된 카카오워크 알림 이미지 정리 — attachments 버킷 notify/ 폴더에서
 * NOTIFY_IMAGE_RETENTION_DAYS(기본 30일) 초과분 삭제.
 * 명세표·계산서·견적서 문자 발송 시 운영방 공유용으로 올라간 이미지가 쌓이는 것을 주기적으로 비운다.
 *   npm run cleanup:notify-images   (env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const BUCKET = "attachments";
const PREFIX = "notify";
const RETENTION_DAYS = Math.max(1, Number(process.env.NOTIFY_IMAGE_RETENTION_DAYS) || 30);

/** 파일명 `...-{ms}.jpg` 끝의 13자리 타임스탬프(ms). created_at 없을 때 폴백. 실패 시 0. */
function tsFromName(name: string): number {
  const m = name.replace(/\.[a-z0-9]+$/i, "").match(/(\d{13})$/);
  return m ? Number(m[1]) : 0;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정");
    process.exit(1);
  }
  const s = createClient(url, key, { auth: { persistSession: false } });
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;

  const toDelete: string[] = [];
  let scanned = 0;
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await s.storage
      .from(BUCKET)
      .list(PREFIX, { limit: pageSize, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error) {
      console.error("list 실패:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const f of data) {
      if (!f.name || f.name.endsWith("/")) continue; // 폴더/플레이스홀더 제외
      scanned++;
      const created = f.created_at ? new Date(f.created_at).getTime() : tsFromName(f.name);
      if (created && created < cutoff) toDelete.push(`${PREFIX}/${f.name}`);
    }
    if (data.length < pageSize) break;
  }

  console.log(`notify/ 스캔 ${scanned}개 · ${RETENTION_DAYS}일 초과 ${toDelete.length}개 삭제 대상`);
  for (let i = 0; i < toDelete.length; i += 100) {
    const { error } = await s.storage.from(BUCKET).remove(toDelete.slice(i, i + 100));
    if (error) console.error("remove 실패:", error.message);
  }
  console.log(`삭제 완료: ${toDelete.length}개`);
}

main().catch((e) => {
  console.error("실패:", e?.message ?? e);
  process.exit(1);
});
