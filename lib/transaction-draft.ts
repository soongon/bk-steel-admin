// 거래 라인(매출·견적 공통) 순수 로직 — 폼이 공유하는 LineDraft·환산·합계·명세 빌더.
// UI(입력 컴포넌트)는 transaction-line-editor.tsx, 헤더(거래처·세금 vs 유효기간·조건)는 각 폼이 보유.

import { calculateRebarWeight, rebarSpecLabel, type RebarCalc } from "@/lib/rebar";
import { type StatementLine } from "@/components/admin/trading-statement";

/** 철제 직접입력용 공용 placeholder 품목(0062 시드 고정 id). 실제 품목명은 라인 display_name. */
export const STEEL_CUSTOM_ITEM_ID = "00000000-0000-0000-0000-0000000057ee";

/** 거래 라인 입력 초안 — 매출·견적 폼 공유. */
export type LineDraft = {
  itemKind: "rebar" | "steel";
  itemId: string;
  unit: "ea" | "kg" | "ton";
  qty: number;
  unitPrice: number;
  tonMetric: boolean;
  /** 운송비 포함 등 — 단가 계산 대신 라인 총액을 직접 입력(원). null/미설정이면 자동 계산. */
  manualAmount?: number | null;
  /** 철제 직접입력 시 실제 품목명(공용 STEEL_CUSTOM item 에 라벨 오버라이드). 없으면 item.name. */
  displayName?: string | null;
  /** 철제 직접입력 규격(품명과 분리, 예: 75x75x6T 10M). 없으면 null(철근은 조합). */
  specText?: string | null;
};

/** 단위 옵션 — 폼 select 공통. ton_metric 은 unit='ton' + tonMetric=true 로 분해. */
export const UNIT_OPTIONS = [
  { value: "ea", label: "가닥/EA" },
  { value: "kg", label: "kg" },
  { value: "ton", label: "톤 (이론중량)" },
  { value: "ton_metric", label: "톤 (1,000kg)" },
] as const;

/** calcLineDraft·buildStatementLines 가 요구하는 품목 최소 필드. sale Item·quote QuoteItem 호환. */
export type DraftItem = {
  id: string;
  name: string;
  rebar_spec_code: string | null;
  rebar_grade_code: string | null;
  length_m: number | null;
  bars_per_tonne: number | null;
};
export type DraftRebarSpec = {
  spec_code: string;
  unit_weight_kg_per_m: number;
  standard_length_m: number;
};

/** 라인 → 품목·환산·공급가. 철근은 이론중량(올림) 기준, 비철근은 단가×수량. */
export function calcLineDraft(
  items: DraftItem[],
  rebarSpecs: DraftRebarSpec[],
  l: LineDraft,
): { item: DraftItem | null; calc: RebarCalc | null; subtotal: number } {
  const item = items.find((i) => i.id === l.itemId) ?? null;
  const spec = item?.rebar_spec_code
    ? rebarSpecs.find((s) => s.spec_code === item.rebar_spec_code) ?? null
    : null;
  const calc =
    item && spec ? calculateRebarWeight(item, spec, l.unit, l.qty, l.unitPrice, l.tonMetric, true) : null;
  const autoSubtotal = calc ? calc.subtotal : Math.round(l.unitPrice * l.qty);
  // 금액 직접입력(운송비 포함 등)이면 그 값이 공급가. 중량(재고)은 그대로 계산.
  const subtotal = l.manualAmount != null && l.manualAmount > 0 ? Math.round(l.manualAmount) : autoSubtotal;
  return { item, calc, subtotal };
}


/** FormData 의 lines JSON 직렬화용 — RPC(create_*_with_lines)가 받는 형태. */
export function serializeLines(
  items: DraftItem[],
  rebarSpecs: DraftRebarSpec[],
  lines: LineDraft[],
): string {
  return JSON.stringify(
    lines.map((l) => {
      const { calc: c } = calcLineDraft(items, rebarSpecs, l);
      return {
        item_id: l.itemId,
        unit: l.unit,
        qty: l.qty,
        unit_price_krw: l.unitPrice,
        weight_kg: c ? c.weightKg : null,
        // 톤(1,000kg) 여부를 영구 저장 — weight_kg 만으론 이론중량 톤과 구분 불가(수정 시 손실).
        ton_metric: l.tonMetric,
        // 금액 직접입력(운송비 포함 등) 시 라인 총액. null이면 자동 계산.
        manual_amount: l.manualAmount ?? null,
        // 철제 직접입력 품목명(공용 STEEL_CUSTOM 라벨 오버라이드). null이면 item.name.
        display_name: l.displayName?.trim() || null,
        // 철제 직접입력 규격(품명과 분리). null이면 없음/철근은 조합.
        spec_text: l.specText?.trim() || null,
      };
    }),
  );
}

/** 거래명세표·견적서 출력용 라인(StatementLine[]) 빌더. vatRate(%) 로 라인별 세액 계산. */
export function buildStatementLines(
  items: DraftItem[],
  rebarSpecs: DraftRebarSpec[],
  lines: LineDraft[],
  vatRate: number,
): StatementLine[] {
  return lines
    .map((l): StatementLine | null => {
      const { item, calc: c, subtotal: sub } = calcLineDraft(items, rebarSpecs, l);
      if (!item) return null;
      const isReb = !!item.rebar_spec_code && !!c;
      const spec = isReb ? rebarSpecLabel(item) : l.specText?.trim() || ""; // 철제 직접입력 규격
      const unitLabel = l.unit === "ton" ? "톤" : l.unit === "kg" ? "kg" : "EA";
      return {
        item_name: l.displayName?.trim() || item.name,
        spec,
        is_rebar: isReb,
        qty: l.qty,
        unit: unitLabel,
        unit_price_krw:
          l.manualAmount != null && l.manualAmount > 0
            ? 0 // 금액 직접입력(단가 미입력) → '-'
            : isReb
              ? l.unitPrice
              : l.qty > 0
                ? Math.round(sub / l.qty)
                : l.unitPrice,
        subtotal_krw: sub,
        vat_krw: Math.round((sub * vatRate) / 100),
        weight_kg: isReb && c ? c.weightKg : null,
      };
    })
    .filter((x): x is StatementLine => x !== null);
}
