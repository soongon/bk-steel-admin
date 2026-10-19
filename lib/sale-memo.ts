/** 매출 메모 기록(0080 sale_memo) — 화면·서버 액션 공용. 시각·작성자는 DB 트리거가 채운다. */
export type SaleMemo = {
  id: string;
  body: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
};

/** DB CHECK(chk_sale_memo_body) 와 같은 상한. */
export const SALE_MEMO_MAX = 2000;

export const SALE_MEMO_COLUMNS = "id, body, created_at, created_by, created_by_name";
