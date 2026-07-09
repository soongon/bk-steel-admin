// 철근(이형철근) 환산·정렬 공통 로직 — 매출/매입 폼이 공유.
// 핵심 도메인 룰: '1톤'은 명목 호칭이고 실제 중량은 규격×길이별 표준본수 × 1본 이론중량.
// 1톤 ≠ 1000kg. 단가는 원/kg 이며 공급가 = 단가 × 실제 이론중량(weightKg).

/** 철근 여부 — rebar_spec_code 가 있으면 이형철근(환산 대상). category 보조. */
export const isRebarItem = (i: { category: string; rebar_spec_code: string | null }) =>
  i.category === "rebar" || !!i.rebar_spec_code;

/** 철근 규격 라벨 조합 — "D13 SD400 8M". 명세표·견적서·계산서 공통(4곳 중복 제거). */
export function rebarSpecLabel(item: {
  rebar_spec_code?: string | null;
  rebar_grade_code?: string | null;
  length_m?: number | null;
}): string {
  return [item.rebar_spec_code, item.rebar_grade_code, item.length_m ? `${item.length_m}M` : null]
    .filter(Boolean)
    .join(" ");
}

/** "D13" → 13. 정렬용(10미리부터). 못 읽으면 맨 뒤. */
const specMm = (code: string | null) => {
  const n = parseInt(String(code ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 9999;
};

/** 철근 정렬: 8M 우선 → 지름(10미리부터) → 길이. */
export function sortRebar(
  a: { length_m: number | null; rebar_spec_code: string | null },
  b: { length_m: number | null; rebar_spec_code: string | null },
): number {
  const a8 = a.length_m === 8 ? 0 : 1;
  const b8 = b.length_m === 8 ? 0 : 1;
  if (a8 !== b8) return a8 - b8;
  const sa = specMm(a.rebar_spec_code);
  const sb = specMm(b.rebar_spec_code);
  if (sa !== sb) return sa - sb;
  return (a.length_m ?? 0) - (b.length_m ?? 0);
}

export type RebarCalc = {
  bars: number; // 가닥수
  weightKg: number; // 적용 중량(kg) — 이론중량 또는 1000kg/톤
  kgPerBar: number; // 1본 중량
  lengthM: number; // 적용 길이
  subtotal: number; // 공급가 = 원/kg 단가 × weightKg
  tonStd: boolean; // 톤 단위 + 표준본수(bars_per_tonne) 적용됨
  tonMetric: boolean; // 톤 단위 + 1톤=1000kg 청구 적용됨
};

/**
 * 철근 환산 — 단위(가닥/kg/톤) × 수량 → 가닥수·이론중량·공급가.
 * spec 이 없으면(비철근) 호출하지 않는다(호출처에서 가드). qty<=0 이면 null.
 */
export function calculateRebarWeight(
  item: { length_m: number | null; bars_per_tonne: number | null },
  spec: { unit_weight_kg_per_m: number; standard_length_m: number },
  unit: "ea" | "kg" | "ton",
  qty: number,
  unitPrice: number,
  tonAsMetric = false,
  ceilWeight = false,
): RebarCalc | null {
  if (qty <= 0) return null;
  const lengthM = item.length_m ?? spec.standard_length_m ?? 8;
  const kgPerBar = spec.unit_weight_kg_per_m * lengthM;
  let bars = 0;
  let weightKg = 0;
  if (unit === "ea") {
    bars = qty;
    weightKg = bars * kgPerBar;
  } else if (unit === "kg") {
    weightKg = qty;
    bars = Math.ceil(weightKg / kgPerBar);
  } else if (tonAsMetric) {
    // 톤 — 소량(배달비 포함) 관행: 1톤 = 1,000kg 로 청구. 이론중량 대신 명목 1000kg/톤.
    weightKg = qty * 1000;
    bars = Math.round(weightKg / kgPerBar);
  } else {
    // ton — '1톤'은 명목. 실제는 규격×길이별 표준본수 × 1본중량(이론중량). 1000kg 아님.
    const bpt = item.bars_per_tonne ?? null;
    if (bpt) {
      // '1톤' 이론중량(정수 kg)을 먼저 산출 → 톤수만큼 곱한다. 가닥을 모두 합친 뒤 곱하면
      // 1톤당 소수(예: D13 955.2kg)가 톤수만큼 누적돼 '1톤 금액 × N' 과 어긋난다.
      // (예: D13 5톤 = round(955.2)=955 × 5 = 4775kg, 940원/kg → 4,488,500)
      const perTonWeightKg = Math.round(bpt * kgPerBar);
      weightKg = perTonWeightKg * qty;
      bars = Math.round(qty * bpt);
    } else {
      weightKg = qty * 1000; // 표준본수 없는 비표준 길이 → 명목 1000kg fallback
      bars = Math.ceil(weightKg / kgPerBar);
    }
  }
  // 실중량 올림(예: 940.8 → 941) — 청구·표기 정수화. 호출처(매출)가 켤 때만.
  if (ceilWeight) weightKg = Math.ceil(weightKg);
  // 철근 단가는 원/kg — 단위(가닥·kg·톤)와 무관하게 공급가 = 단가 × 적용 중량.
  const subtotal = Math.round(unitPrice * weightKg);
  const tonStd = unit === "ton" && !tonAsMetric && item.bars_per_tonne != null;
  const tonMetric = unit === "ton" && tonAsMetric;
  return { bars, weightKg, kgPerBar, lengthM, subtotal, tonStd, tonMetric };
}
