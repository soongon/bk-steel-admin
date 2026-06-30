import type { MessageProvider } from "./types";
import { popbillMessageProvider } from "./popbill";
import { solapiMessageProvider } from "./solapi";
import { mockMessageProvider } from "./mock";

/**
 * 설정된 고객 메시징 ASP 어댑터.
 *  - MESSAGE_PROVIDER=mock|solapi|popbill → 강제
 *  - 자동: 팝빌 키 + 발신번호(POPBILL_SENDER) 둘 다 → popbill(문자+알림톡)
 *          (발신번호 미등록 시 명세서 MMS 가 끊기지 않게 솔라피로 fallback)
 *  - 솔라피 키만 → solapi(문자만)
 *  - 팝빌 키만(발신번호 없음) → popbill (알림톡 강제 시 MESSAGE_PROVIDER=popbill)
 *  - 그 외 → mock(무발송)
 */
export function getMessageProvider(): MessageProvider {
  const forced = process.env.MESSAGE_PROVIDER;
  if (forced === "mock") return mockMessageProvider;
  if (forced === "solapi") return solapiMessageProvider;
  if (forced === "popbill") return popbillMessageProvider;

  if (process.env.POPBILL_LINK_ID && process.env.POPBILL_SENDER) return popbillMessageProvider;
  if (process.env.SOLAPI_API_KEY) return solapiMessageProvider;
  if (process.env.POPBILL_LINK_ID) return popbillMessageProvider;
  return mockMessageProvider;
}

export * from "./types";
