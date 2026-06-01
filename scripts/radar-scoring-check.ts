/**
 * 발주 레이더 점수 로직 검증 — 의존성 없는 순수 함수 단언.
 * 실행: `npx tsx scripts/radar-scoring-check.ts`
 *
 * 정식 테스트 러너(vitest/jest)가 레포에 없어, tsx로 바로 도는 assert 스크립트로 둠.
 */

import assert from "node:assert/strict";
import {
  computeRelevance,
  estimateRebarTon,
  scoreDistance,
  scoreArea,
  scoreUsage,
} from "../lib/radar/scoring";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── 용도 점수 ──────────────────────────────────────────────
check("공장은 스윗스팟(양수)", () => {
  assert.ok(scoreUsage("factory") > 0);
});
check("대단지 아파트는 감산(음수)", () => {
  assert.ok(scoreUsage("apartment") < 0);
});
check("미상 용도는 etc로 폴백", () => {
  assert.equal(scoreUsage(null), scoreUsage("etc"));
});

// ── 거리 점수 ──────────────────────────────────────────────
check("납품 반경 이내는 만점", () => {
  assert.equal(scoreDistance(5), 1);
});
check("아주 멀면 0", () => {
  assert.equal(scoreDistance(100), 0);
});
check("거리 미상은 중립 0.5", () => {
  assert.equal(scoreDistance(null), 0.5);
});

// ── 면적 점수 ──────────────────────────────────────────────
check("연면적 클수록 점수 ↑ (단조)", () => {
  assert.ok(scoreArea(1000) < scoreArea(2500));
});

// ── 종합: 가까운 대형 공장(A) > 먼 소형 아파트(C) ───────────
check("가까운 대형 공장이 먼 소형 아파트보다 높음", () => {
  const factory = computeRelevance({
    usage: "factory",
    structure: "steel",
    floorArea: 4000,
    distanceKm: 8,
  });
  const apt = computeRelevance({
    usage: "apartment",
    structure: "RC",
    floorArea: 800,
    distanceKm: 55,
  });
  assert.ok(factory.score > apt.score);
  assert.equal(factory.grade, "A");
  assert.equal(apt.grade, "C");
});

check("점수는 0~100 클램프", () => {
  const r = computeRelevance({
    usage: "apartment",
    structure: null,
    floorArea: null,
    distanceKm: 80,
  });
  assert.ok(r.score >= 0 && r.score <= 100);
});

// ── 추정 철근톤 ────────────────────────────────────────────
check("연면적 없으면 톤 추정 불가(null)", () => {
  assert.equal(estimateRebarTon(null, "factory", "RC"), null);
});
check("RC 3000㎡ 공장 ≈ 165톤(55kg/㎡)", () => {
  assert.equal(estimateRebarTon(3000, "factory", "RC"), 165);
});
check("철골은 강관 계수(45kg/㎡) 사용", () => {
  assert.equal(estimateRebarTon(1000, "factory", "steel"), 45);
});

console.log(`\n✓ radar scoring: ${passed} checks passed`);
