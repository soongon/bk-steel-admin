import type { EtaxProvider } from "./types";
import { mockProvider } from "./mock";
import { popbillProvider } from "./popbill";

/**
 * 설정된 전자세금계산서 ASP 어댑터.
 *  - ETAX_PROVIDER=mock → 강제 mock(개발)
 *  - POPBILL_LINK_ID 설정 → popbill(테스트베드/운영은 POPBILL_IS_TEST 로 분기)
 *  - 그 외(키 미설정) → mock (실발행 없이 UI 검증)
 */
export function getEtaxProvider(): EtaxProvider {
  const forced = process.env.ETAX_PROVIDER;
  if (forced === "mock") return mockProvider;
  if (forced === "popbill" || process.env.POPBILL_LINK_ID) return popbillProvider;
  return mockProvider;
}

export * from "./types";
