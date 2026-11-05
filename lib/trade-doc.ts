/**
 * 매출·매입·문의 사진(0099 sale_document·purchase_document, 0100 inquiry_document) — 화면·서버 공용 타입·상수.
 * 파일은 비공개 버킷 trade-docs, 화면엔 서버가 만든 짧은 서명 URL 로만 보인다(lib/trade-docs-server.ts).
 * 올린 사람(created_by)은 본인 사진만 빼기 버튼을 보여 주는 데 쓴다(실제 권한은 RLS).
 */

export type TradeDocParent = "sale" | "purchase" | "inquiry";
export type TradeDocKind = "weigh" | "site" | "receipt" | "goods" | "material";
export const TRADE_DOC_KIND_LABEL: Record<TradeDocKind, string> = {
  weigh: "계근표",
  site: "현장",
  receipt: "영수증",
  goods: "물건",
  material: "자료",
};
/** 종류는 붙이는 곳마다 다르다(DB CHECK 와 같게) — 거래는 계근표·현장·영수증, 문의는 현장·물건(팔려는 철근)·자료(도면·물량표). */
export const TRADE_DOC_KINDS: Record<TradeDocParent, readonly TradeDocKind[]> = {
  sale: ["weigh", "site", "receipt"],
  purchase: ["weigh", "site", "receipt"],
  inquiry: ["site", "goods", "material"],
};
/** 사진을 붙이는 단위 이름 — 안내 문구("거래당 20장") */
export const TRADE_DOC_UNIT: Record<TradeDocParent, string> = { sale: "거래", purchase: "거래", inquiry: "문의" };
export const isTradeDocKind = (v: unknown): v is TradeDocKind => typeof v === "string" && Object.hasOwn(TRADE_DOC_KIND_LABEL, v);
export const isTradeDocKindOf = (parent: TradeDocParent, v: unknown): v is TradeDocKind => isTradeDocKind(v) && TRADE_DOC_KINDS[parent].includes(v);

/** 거래·문의 1건당 사진 상한 */
export const TRADE_DOC_MAX = 20;
/** 업로드 한 번(서버 액션 본문 상한 4MB, next.config)에 싣는 최대 크기 — multipart 여유를 두고 3MB(거래처 이미지와 같음). */
export const TRADE_DOC_BATCH_BYTES = 3 * 1024 * 1024;

/** 화면에 보이는 사진 1장 — url 은 1시간짜리 서명 URL. */
export type TradeDocView = {
  id: string;
  kind: TradeDocKind;
  url: string;
  sort_order: number;
  created_at: string;
  created_by: string | null;
};

/** docs = 반영 뒤 전체 목록. null = 반영은 됐지만 목록(서명 URL)을 다시 읽지 못함 — 화면은 새로고침을 권한다. */
export type TradeDocSyncResult = { ok: true; docs: TradeDocView[] | null; failed: number } | { ok: false; error: string };
