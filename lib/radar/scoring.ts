/**
 * 발주 레이더 점수·추정 — 순수 함수.
 *
 * 입력(용도·구조·연면적·거리) → 0~100 점수 → A/B/C 등급, 그리고 추정 철근톤.
 * 부수효과 없음(테스트 가능). 계수는 전부 config.ts에서 주입 — 여기엔 로직만.
 *
 * 검증: `npx tsx scripts/radar-scoring-check.ts`
 * 참조(핸드오프): §6 철강 관련성 점수
 */

import {
  USAGE_SCORE,
  STRUCTURE_SCORE,
  SCORE_WEIGHTS,
  GRADE_THRESHOLDS,
  FLOOR_AREA_REF_SQM,
  DISTANCE,
  REBAR_KG_PER_SQM,
  STEEL_KG_PER_SQM,
  NARA_CATEGORY_SCORE,
  NARA_WEIGHTS,
  NARA_AMOUNT_TIERS,
} from "./config";
import type { RelevanceGrade, StructureType } from "./types";

/** 0~1 클램프. */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 용도 점수(-1~1). 미상이면 etc. */
export function scoreUsage(usage: string | null): number {
  if (!usage) return USAGE_SCORE.etc;
  return USAGE_SCORE[usage] ?? USAGE_SCORE.etc;
}

/**
 * 구조 점수(0~1). 구조 미상이면 용도로 추정:
 *  - 공장/창고 → 철골 가능성↑
 *  - 그 외 용도 있음 → RC 가정(추정 페널티 0.8배)
 */
export function scoreStructure(
  structure: StructureType | null,
  usage: string | null,
): number {
  if (structure) return STRUCTURE_SCORE[structure] ?? STRUCTURE_SCORE.etc;
  if (usage === "factory" || usage === "warehouse") return STRUCTURE_SCORE.steel;
  if (usage) return STRUCTURE_SCORE.RC * 0.8;
  return STRUCTURE_SCORE.etc;
}

/** 연면적 점수(0~1). 기준 면적 대비 선형, 포화. */
export function scoreArea(floorArea: number | null): number {
  if (!floorArea || floorArea <= 0) return 0;
  return clamp01(floorArea / FLOOR_AREA_REF_SQM);
}

/** 거리 점수(0~1). full 이내=1, zero 밖=0, 사이 선형. 미상=0.5(중립). */
export function scoreDistance(distanceKm: number | null): number {
  if (distanceKm == null) return 0.5;
  if (distanceKm <= DISTANCE.full) return 1;
  if (distanceKm >= DISTANCE.zero) return 0;
  return clamp01((DISTANCE.zero - distanceKm) / (DISTANCE.zero - DISTANCE.full));
}

export interface RelevanceInput {
  usage: string | null;
  structure: StructureType | null;
  floorArea: number | null;
  distanceKm: number | null;
}

export interface RelevanceResult {
  score: number; // 0~100
  grade: RelevanceGrade;
  breakdown: { usage: number; structure: number; floorArea: number; distance: number };
}

/**
 * 관련성 점수·등급. 가중합(usage는 음수 가능 → 전체를 끌어내림) → 0~100 클램프 → A/B/C.
 */
export function computeRelevance(input: RelevanceInput): RelevanceResult {
  const u = scoreUsage(input.usage);
  const s = scoreStructure(input.structure, input.usage);
  const a = scoreArea(input.floorArea);
  const d = scoreDistance(input.distanceKm);

  const parts = {
    usage: u * SCORE_WEIGHTS.usage,
    structure: s * SCORE_WEIGHTS.structure,
    floorArea: a * SCORE_WEIGHTS.floorArea,
    distance: d * SCORE_WEIGHTS.distance,
  };
  const raw = parts.usage + parts.structure + parts.floorArea + parts.distance;
  const score = Math.max(0, Math.min(100, raw));

  const grade: RelevanceGrade =
    score >= GRADE_THRESHOLDS.A ? "A" : score >= GRADE_THRESHOLDS.B ? "B" : "C";

  return { score: Math.round(score * 10) / 10, grade, breakdown: parts };
}

/**
 * 추정 철근/강관 톤. 철골이면 강관 계수, 아니면 용도별 철근 계수.
 * 연면적 없으면 null(= 표기 불가). "추정"이라 UI에 "약 ○톤"으로.
 */
export function estimateRebarTon(
  floorArea: number | null,
  usage: string | null,
  structure: StructureType | null,
): number | null {
  if (!floorArea || floorArea <= 0) return null;
  const kgPerSqm =
    structure === "steel"
      ? STEEL_KG_PER_SQM
      : (usage ? REBAR_KG_PER_SQM[usage] : undefined) ?? REBAR_KG_PER_SQM.etc;
  const ton = (floorArea * kgPerSqm) / 1000;
  return Math.round(ton * 10) / 10;
}

/** 관급 낙찰금액/추정가(원) → 규모 점수(0~1). 미상=0.3. */
export function scoreNaraAmount(amount: number | null): number {
  if (amount == null) return 0.3;
  for (const [threshold, score] of NARA_AMOUNT_TIERS) if (amount >= threshold) return score;
  return 0.2;
}

/**
 * 관급 철근관련성 — 공종 카테고리(건축/구조토목/일반토목) + 낙찰금액 규모.
 * 거리·연면적·구조 입력이 없어 별도 계산. (제외 공종은 수집 단계에서 이미 컷.)
 */
export function computeNaraRelevance(input: {
  category: string | null;
  estAmount: number | null;
}): RelevanceResult {
  const cat = (input.category ? NARA_CATEGORY_SCORE[input.category] : undefined) ?? 0.3;
  const amt = scoreNaraAmount(input.estAmount);
  const parts = {
    usage: cat * NARA_WEIGHTS.category,
    structure: 0,
    floorArea: amt * NARA_WEIGHTS.amount,
    distance: 0,
  };
  const score = Math.max(0, Math.min(100, parts.usage + parts.floorArea));
  const grade: RelevanceGrade =
    score >= GRADE_THRESHOLDS.A ? "A" : score >= GRADE_THRESHOLDS.B ? "B" : "C";
  return { score: Math.round(score * 10) / 10, grade, breakdown: parts };
}
