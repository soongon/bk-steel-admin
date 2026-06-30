import type { MessageProvider } from "./types";
import { popbillMessageProvider } from "./popbill";
import { solapiMessageProvider } from "./solapi";
import { mockMessageProvider } from "./mock";

/**
 * 설정된 고객 메시징 ASP 어댑터.
 *  - MESSAGE_PROVIDER=mock|solapi|popbill → 강제
 *  - 자동: 팝빌 키 + 발신번호(POPBILL_SENDER) 둘 다 있을 때만 → popbill(문자+알림톡)
 *          ※ 팝빌 메시징은 발신번호 등록이 게이트. 미등록(현재)이면 MMS 는 솔라피.
 *  - 솔라피 키 → solapi(문자만)
 *  - 그 외 → mock(무발송)
 * 팝빌 LinkHub 키는 세금계산서용으로도 설정돼 있으나, 발신번호 없이는 메시징에 쓰지 않는다
 * (카카오 알림톡 도입 시 POPBILL_SENDER 등록하면 자동 전환).
 */
export function getMessageProvider(): MessageProvider {
  const forced = process.env.MESSAGE_PROVIDER;
  if (forced === "mock") return mockMessageProvider;
  if (forced === "solapi") return solapiMessageProvider;
  if (forced === "popbill") return popbillMessageProvider;

  if (process.env.POPBILL_LINK_ID && process.env.POPBILL_SENDER) return popbillMessageProvider;
  if (process.env.SOLAPI_API_KEY) return solapiMessageProvider;
  return mockMessageProvider;
}

export * from "./types";
