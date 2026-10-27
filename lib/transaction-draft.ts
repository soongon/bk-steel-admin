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
  /** 1톤=1,000kg 기준(소량 청구) — unit 'ton' 이면 톤(1,000kg), 'ea' 면 가닥(톤기준). 견적은 quote_line.ton_metric 에 저장. */
  tonMetric: boolean;
  /** 운송비 포함 등 — 단가 계산 대신 라인 총액을 직접 입력(원). null/미설정이면 자동 계산. */
  manualAmount?: number | null;
  /** 철제 직접입력 시 실제 품목명(공용 STEEL_CUSTOM item 에 라벨 오버라이드). 없으면 item.name. */
  displayName?: string | null;
  /** 철제 직접입력 규격(품명과 분리, 예: 75x75x6T 10M). 없으면 null(철근은 조합). */
  specText?: string | null;
  /** 라인 비고(조정 라인 사유 등). 매출 라인 수정(replace_sale_lines)만 저장. */
  notes?: string | null;
  /** 계산서 금액 맞춤 조정 라인(0086 과 같은 모양: 철제 직접입력·수량 1·단가=차액, 음수 가능·중량 없음). */
  adjustment?: boolean;
};

/** 단위 옵션 — 폼 select 공통. ton_metric·ea_metric 은 unit='ton'·'ea' + tonMetric=true 로 분해. */
export const UNIT_OPTIONS = [
  { value: "ea", label: "가닥/EA" },
  { value: "ea_metric", label: "가닥/EA (톤기준)" },
  { value: "kg", label: "kg" },
  { value: "ton", label: "톤 (이론중량)" },
  { value: "ton_metric", label: "톤 (1,000kg)" },
] as const;

/** 라인 단위 → select 값. */
export function unitOptionValue(unit: LineDraft["unit"], tonMetric: boolean): string {
  return tonMetric && (unit === "ton" || unit === "ea") ? `${unit}_metric` : unit;
}

/** select 값 → 라인 단위 + 1톤=1,000kg 기준 여부. */
export function parseUnitOption(value: string): { unit: LineDraft["unit"]; tonMetric: boolean } {
  if (value === "ton_metric") return { unit: "ton", tonMetric: true };
  if (value === "ea_metric") return { unit: "ea", tonMetric: true };
  return { unit: value === "kg" || value === "ton" ? value : "ea", tonMetric: false };
}

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


/** 저장된 sale_line 행(상세 페이지 embed 모양) — saleLineToDraft 입력. */
export type StoredSaleLine = {
  item_id?: string | null;
  item: { id: string; rebar_spec_code?: string | null } | null;
  unit: string;
  qty: number | string;
  unit_price_krw: number | string;
  weight_kg: number | string | null;
  line_subtotal_krw: number | string | null;
  display_name: string | null;
  spec_text?: string | null;
  notes?: string | null;
};

/**
 * 저장된 sale_line → LineDraft (매출 수정 프리필, 0089).
 * sale_line 엔 ton_metric·manual_amount 컬럼이 없어(견적 라인과 달리) 저장된 중량·단가로 추론한다:
 *   · tonMetric — 이론중량(false)·1,000kg 기준(true) 두 가지로 환산해 저장 중량과 맞는 쪽(0.5kg 이내). 둘 다 아니면 false.
 *   · manualAmount — 단가 0 이고 공급가>0 이면 금액 직접입력.
 *   · adjustment — 철제 직접입력 품목·중량 없음·표시명 '계산서 금액 맞춤…'(0086 조정 라인).
 */
export function saleLineToDraft(items: DraftItem[], rebarSpecs: DraftRebarSpec[], l: StoredSaleLine): LineDraft {
  const itemId = String(l.item?.id ?? l.item_id ?? "");
  const isReb = !!l.item?.rebar_spec_code;
  const u = l.unit === "ton" || l.unit === "kg" ? l.unit : "ea";
  const qty = Number(l.qty);
  const unitPrice = Number(l.unit_price_krw);
  const w = l.weight_kg != null && l.weight_kg !== "" ? Number(l.weight_kg) : null;
  const sub = l.line_subtotal_krw != null ? Number(l.line_subtotal_krw) : null;
  const base: LineDraft = {
    itemKind: isReb ? "rebar" : "steel",
    itemId,
    unit: u,
    qty,
    unitPrice,
    tonMetric: false,
    manualAmount: unitPrice === 0 && sub != null && sub > 0 ? sub : null,
    displayName: l.display_name ?? null,
    specText: l.spec_text ?? null,
    notes: l.notes ?? null,
    adjustment:
      itemId === STEEL_CUSTOM_ITEM_ID && w == null && (l.display_name ?? "").startsWith("계산서 금액 맞춤"),
  };
  if (isReb && w != null) {
    const plain = calcLineDraft(items, rebarSpecs, base).calc?.weightKg ?? null;
    if (plain != null && Math.abs(plain - w) >= 0.5) {
      const metric = calcLineDraft(items, rebarSpecs, { ...base, tonMetric: true }).calc?.weightKg ?? null;
      if (metric != null && Math.abs(metric - w) < 0.5) base.tonMetric = true;
    }
  }
  return base;
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
        // 1톤=1,000kg 기준(톤(1,000kg)·가닥(톤기준)) 여부를 영구 저장 — weight_kg 만으론 이론중량과 구분 불가(수정 시 손실).
        ton_metric: l.tonMetric,
        // 금액 직접입력(운송비 포함 등) 시 라인 총액. null이면 자동 계산.
        manual_amount: l.manualAmount ?? null,
        // 철제 직접입력 품목명(공용 STEEL_CUSTOM 라벨 오버라이드). null이면 item.name.
        display_name: l.displayName?.trim() || null,
        // 철제 직접입력 규격(품명과 분리). null이면 없음/철근은 조합.
        spec_text: l.specText?.trim() || null,
        // 라인 비고(조정 라인 사유). 견적 RPC 는 무시.
        notes: l.notes?.trim() || null,
        // 조정 라인 — 서버 검증에서 음수 단가 허용.
        allow_negative: l.adjustment === true,
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
