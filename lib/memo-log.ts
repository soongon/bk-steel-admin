/**
 * 거래 메모 기록 — 매출(0080 sale_memo)·매입(0081 purchase_memo)·견적서(0082 quote_memo) 상세에서 시간순으로 쌓는
 * 내부 메모(문서·문자엔 안 나감). 화면·서버 공용.
 * 시각·작성자는 DB 트리거가 채운다. 작성자 이름(created_by_name)은 DB 에만 있고 화면엔 안 쓴다(2026-10-19 사용자 결정).
 * created_by 는 본인 메모만 지우기 버튼을 보여 주는 데 쓴다(실제 권한은 RLS).
 */
export type MemoEntry = {
  id: string;
  body: string;
  created_at: string;
  created_by: string | null;
};

export type MemoAddResult = { ok: true; memo: MemoEntry } | { ok: false; error: string };
export type MemoDeleteResult = { ok: true } | { ok: false; error: string };

/** DB CHECK(chk_*_memo_body) 와 같은 상한. */
export const MEMO_MAX = 2000;

export const MEMO_COLUMNS = "id, body, created_at, created_by";
