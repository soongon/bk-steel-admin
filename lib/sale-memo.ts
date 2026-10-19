/**
 * 매출 메모 기록(0080 sale_memo) — 화면·서버 액션 공용. 시각·작성자는 DB 트리거가 채운다.
 * 작성자 이름(created_by_name)은 DB 에만 남고 화면엔 안 보인다(2026-10-19 사용자 결정). created_by 는 본인 메모 삭제 판단용.
 */
export type SaleMemo = {
  id: string;
  body: string;
  created_at: string;
  created_by: string | null;
};

/** DB CHECK(chk_sale_memo_body) 와 같은 상한. */
export const SALE_MEMO_MAX = 2000;

export const SALE_MEMO_COLUMNS = "id, body, created_at, created_by";
