/**
 * 매입견적서 — 공용 타입·헬퍼. (DB: purchase_quote / purchase_quote_line, 0075)
 * 매입견적은 "우리가 사는 쪽"의 kg당 단가 제시서. 총중량·총액은 당일 계근 후 확정되므로 문서에 싣지 않는다.
 */

export type PurchaseQuoteStatus = "draft" | "sent" | "done" | "expired";

export const PURCHASE_QUOTE_STATUS_LABEL: Record<PurchaseQuoteStatus, { label: string; cls: string }> = {
  draft: { label: "작성", cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
  sent: { label: "발송", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  done: { label: "매입완료", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  expired: { label: "만료", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
};

/** 폼·문서 공용 라인 초안 — 품목명 + 규격·상태 + 원/kg. 수량·중량 없음. */
export type PurchaseQuoteLineDraft = {
  itemId: string | null; // 품목 마스터와 이름이 일치할 때만(선택)
  displayName: string;
  specText: string | null;
  pricePerKg: number; // 원/kg
  notes: string | null;
};

/** kg당 단가 → 톤당 환산(원/톤). 1톤 = 1,000kg. */
export const perKgToPerTon = (pricePerKg: number) => Math.round(pricePerKg * 1000);

/** 조건 기본 문구 — 폼 placeholder·문서 폴백. 비워 두면 문서에 이 문구가 찍힌다. */
export const PURCHASE_QUOTE_DEFAULT_TERMS = {
  weighing: "당일 공인 계근대 계근표 기준 (총중량·금액은 계근 후 확정)",
  delivery: "당사 상차·운반 (현장 상차 기준)",
  payment: "계근 당일 계좌 송금",
} as const;

/**
 * 판매자 명함 이미지 — 공용 첨부(attachment)에 entity_type 'purchase_quote' + 이 kind 로 둔다(0077).
 * 문서·문자 이미지에는 싣지 않는다(상대방 자신의 명함이라 상세 화면 참고용).
 */
export const PURCHASE_QUOTE_CARD_KIND = "business_card";
/** 견적 1건당 명함 사진 상한 — 앞·뒷면 × 담당자 2명 정도. */
export const PURCHASE_QUOTE_CARD_MAX = 4;

/** 서버 액션(lines FormData)로 보낼 직렬화 — DB 컬럼명 기준. */
export function serializePurchaseQuoteLines(lines: PurchaseQuoteLineDraft[]): string {
  return JSON.stringify(
    lines.map((l) => ({
      item_id: l.itemId,
      display_name: l.displayName,
      spec_text: l.specText,
      price_per_kg_krw: l.pricePerKg,
      notes: l.notes,
    })),
  );
}
