// 매입 라인 순수 로직 — 폼(purchase-form-dialog)과 서버 액션이 공유하는 라인 초안·환산·직렬화.
// 매출의 lib/transaction-draft 와 같은 역할. 매입 라인은 실중량(actual_weight_kg)·가닥수(bars_count)가 있어 따로 둔다.

import { calculateRebarWeight, type RebarCalc } from "@/lib/rebar";
import { STEEL_CUSTOM_ITEM_ID, type DraftItem, type DraftRebarSpec } from "@/lib/transaction-draft";

export type PurchaseUnit = "ea" | "kg" | "ton";

/** 매입 라인 입력 초안 — 신규 등록·라인 수정(0093) 공용. */
export type PurchaseLineDraft = {
  itemKind: "rebar" | "steel";
  itemId: string;
  unit: PurchaseUnit;
  qty: number;
  unitPrice: number;
  /** 검수 후 측정한 실제 중량(kg). kg 단위면 수량이 곧 실중량. null 이면 이론중량. */
  actualWeight: number | null;
  /** 라인 비고(홈택스 계산서분·조정 라인 사유 등). */
  notes?: string | null;
  /** 계산서 금액 맞춤 조정 라인(철제 직접입력·수량 1·단가=차액, 음수 가능·중량 없음). */
  adjustment?: boolean;
};

/** 홈택스 수집본으로 자동 생성된 금액 라인의 비고 머리말(lib/hometax/reconcile-buy createPurchaseFromInvoice). */
export const HOMETAX_LINE_PREFIX = "홈택스 계산서분";
/** 계산서 금액 맞춤 조정 라인의 비고 머리말. */
export const ADJUSTMENT_LINE_PREFIX = "계산서 금액 맞춤";

/**
 * 라인 → 품목·환산·공급가. 철근은 원/kg × (실중량 ?? 이론중량), 비철근은 단가×수량.
 * (purchase-form-dialog 가 쓰던 calcLine 과 같은 계산 — 서버 createPurchase 의 lineSubtotal 과 일치.)
 */
export function calcPurchaseLine(
  items: DraftItem[],
  rebarSpecs: DraftRebarSpec[],
  l: PurchaseLineDraft,
): { item: DraftItem | null; calc: RebarCalc | null; theoreticalKg: number | null; subtotal: number } {
  const item = items.find((i) => i.id === l.itemId) ?? null;
  const spec = item?.rebar_spec_code
    ? rebarSpecs.find((s) => s.spec_code === item.rebar_spec_code) ?? null
    : null;
  const calc = item && spec ? calculateRebarWeight(item, spec, l.unit, l.qty, l.unitPrice) : null;
  const theoreticalKg = calc ? calc.weightKg : null;
  const weightForPrice = l.actualWeight ?? theoreticalKg;
  const subtotal = weightForPrice ? Math.round(l.unitPrice * weightForPrice) : Math.round(l.unitPrice * l.qty);
  return { item, calc, theoreticalKg, subtotal };
}

/** 폼이 서버로 보내는 lines JSON(서버 parsePurchaseLinesJson 입력). 철근 환산중량·가닥수·실중량 동봉. */
export function serializePurchaseLines(items: DraftItem[], rebarSpecs: DraftRebarSpec[], lines: PurchaseLineDraft[]): string {
  return JSON.stringify(
    lines.map((l) => {
      const { calc } = calcPurchaseLine(items, rebarSpecs, l);
      return {
        item_id: l.itemId,
        unit: l.unit,
        qty: l.qty,
        unit_price_krw: l.unitPrice,
        bars_count: calc && calc.bars > 0 ? calc.bars : null,
        theoretical_weight_kg: calc ? calc.weightKg : null,
        actual_weight_kg: l.actualWeight,
        notes: l.notes?.trim() || null,
        allow_negative: l.adjustment === true,
      };
    }),
  );
}

/** 저장된 purchase_line 행(상세 페이지 embed 모양) — purchaseLineToDraft 입력. */
export type StoredPurchaseLine = {
  item_id?: string | null;
  item: { id: string; rebar_spec_code?: string | null } | null;
  acquired_unit: string;
  acquired_qty: number | string;
  unit_price_krw: number | string;
  actual_weight_kg: number | string | null;
  theoretical_weight_kg?: number | string | null;
  notes?: string | null;
};

/**
 * 저장된 purchase_line → PurchaseLineDraft (매입 수정 프리필, 0093).
 *   · piece/bundle 은 폼 단위 'ea' 로. kg 라인은 수량=실중량이라 actualWeight 는 수량과 같다.
 *   · adjustment — 철제 직접입력 품목·중량 없음·비고 '계산서 금액 맞춤…'.
 */
export function purchaseLineToDraft(l: StoredPurchaseLine): PurchaseLineDraft {
  const itemId = String(l.item?.id ?? l.item_id ?? "");
  const isReb = !!l.item?.rebar_spec_code;
  const unit: PurchaseUnit = l.acquired_unit === "kg" || l.acquired_unit === "ton" ? l.acquired_unit : "ea";
  const qty = Number(l.acquired_qty);
  const actual = l.actual_weight_kg != null && l.actual_weight_kg !== "" ? Number(l.actual_weight_kg) : null;
  const notes = l.notes ?? null;
  return {
    itemKind: isReb ? "rebar" : "steel",
    itemId,
    unit,
    qty,
    unitPrice: Number(l.unit_price_krw),
    actualWeight: unit === "kg" ? qty : actual,
    notes,
    adjustment: itemId === STEEL_CUSTOM_ITEM_ID && actual == null && (notes ?? "").startsWith(ADJUSTMENT_LINE_PREFIX),
  };
}

/** 홈택스 자동 생성 매입의 '품목 미정' 금액 라인인지(철제 직접입력·수량 1 ea·비고 '홈택스 계산서분…'). */
export function isHometaxPlaceholderLine(l: { itemId: string; unit: string; qty: number; notes?: string | null }): boolean {
  return l.itemId === STEEL_CUSTOM_ITEM_ID && l.unit === "ea" && Number(l.qty) === 1 && (l.notes ?? "").startsWith(HOMETAX_LINE_PREFIX);
}

/**
 * 계산서 금액 맞춤 — 고정 공급가액(홈택스 계산서)과 라인 합의 차액을 조정 라인 1줄로 넣어 합을 맞춘다.
 * 기존 조정 라인은 빼고 다시 계산(여러 번 눌러도 1줄). 차액 0이면 조정 라인 없이 돌려준다.
 */
export function withAdjustmentLine(
  items: DraftItem[],
  rebarSpecs: DraftRebarSpec[],
  lines: PurchaseLineDraft[],
  fixedSubtotal: number,
  ntsConfirmNum: string | null,
  fmt: (n: number) => string,
): { lines: PurchaseLineDraft[]; diff: number; baseSubtotal: number } {
  const base = lines.filter((l) => !l.adjustment);
  const baseSubtotal = base.reduce((s, l) => s + calcPurchaseLine(items, rebarSpecs, l).subtotal, 0);
  const diff = fixedSubtotal - baseSubtotal;
  if (diff === 0) return { lines: base, diff, baseSubtotal };
  return {
    lines: [
      ...base,
      {
        itemKind: "steel",
        itemId: STEEL_CUSTOM_ITEM_ID,
        unit: "ea",
        qty: 1,
        unitPrice: diff,
        actualWeight: null,
        notes: `${ADJUSTMENT_LINE_PREFIX}${ntsConfirmNum ? `(승인 …${ntsConfirmNum.slice(-6)})` : ""}: 품목 합 ${fmt(baseSubtotal)} → 계산서 공급가액 ${fmt(fixedSubtotal)}`,
        adjustment: true,
      },
    ],
    diff,
    baseSubtotal,
  };
}
