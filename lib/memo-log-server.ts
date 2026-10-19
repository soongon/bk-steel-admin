import "server-only";
import { createClient } from "@/lib/supabase/server";
import { MEMO_COLUMNS, MEMO_MAX, type MemoAddResult, type MemoDeleteResult, type MemoEntry } from "@/lib/memo-log";

/** 메모 기록 표 — 거래별로 같은 구조(0080·0081). */
const TABLES = {
  sale: { table: "sale_memo", fk: "sale_id", label: "매출" },
  purchase: { table: "purchase_memo", fk: "purchase_id", label: "매입" },
} as const;
export type MemoParent = keyof typeof TABLES;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function friendly(parent: MemoParent, message: string): string {
  const { table, fk, label } = TABLES[parent];
  if (message.includes("row-level security")) return "권한이 없습니다 (이 책 staff 이상 필요).";
  if (message.includes(`chk_${table}_body`)) return `메모 내용을 입력해 주세요 (${MEMO_MAX.toLocaleString()}자 이내).`;
  if (message.includes(`${table}_${fk}_fkey`)) return `${label}을 찾을 수 없습니다. 새로고침해 주세요.`;
  return message;
}

/** 사용자 세션(RLS)으로 넣는다 — 작성 시각·작성자는 트리거, 권한은 그 거래의 책 staff 이상. */
export async function insertMemo(parent: MemoParent, parentId: string, body: string): Promise<MemoAddResult> {
  const { table, fk, label } = TABLES[parent];
  if (!UUID_RE.test(parentId)) return { ok: false, error: `잘못된 ${label}입니다.` };
  const text = body.trim();
  if (!text) return { ok: false, error: "메모 내용을 입력해 주세요." };
  if (text.length > MEMO_MAX) return { ok: false, error: `메모는 ${MEMO_MAX.toLocaleString()}자까지 쓸 수 있습니다.` };

  const supabase = await createClient();
  const { data, error } = await supabase.from(table).insert({ [fk]: parentId, body: text }).select(MEMO_COLUMNS).single();
  if (error || !data) return { ok: false, error: friendly(parent, error?.message ?? "메모를 저장하지 못했습니다.") };
  return { ok: true, memo: data as unknown as MemoEntry };
}

/** 본인이 쓴 메모만 지워진다(RLS) — 남의 메모·권한 없음은 0건이라 그대로 알린다. */
export async function removeMemo(parent: MemoParent, memoId: string): Promise<MemoDeleteResult> {
  const { table } = TABLES[parent];
  if (!UUID_RE.test(memoId)) return { ok: false, error: "잘못된 메모입니다." };
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).delete().eq("id", memoId).select("id");
  if (error) return { ok: false, error: friendly(parent, error.message) };
  if (!data || data.length === 0) return { ok: false, error: "지울 수 없습니다 — 본인이 쓴 메모만 지울 수 있습니다." };
  return { ok: true };
}
