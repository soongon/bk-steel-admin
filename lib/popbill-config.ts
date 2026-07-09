// 팝빌 SDK 공용 설정 — 세금계산서(lib/etax/popbill)·메시지(lib/message/popbill) 어댑터 공유.
// ⚠️ popbill SDK(CJS) 팩토리(TaxinvoiceService/MessageService/KakaoService)는 서비스 인스턴스를
// this(모듈 객체)에 캐싱한다. `import * as popbill` 의 ESM namespace 는 Next 프로덕션 번들에서
// frozen 이라 캐싱 쓰기가 무시돼 팩토리가 undefined 를 반환(로컬 tsx 는 mutable 이라 정상 →
// 프로덕션만 발생). createRequire 로 실제 mutable CJS exports 를 받는다.
import { createRequire } from "node:module";

export const popbill = createRequire(import.meta.url)("popbill") as typeof import("popbill");

/** 운영/테스트 게이트. 기본 테스트베드(국세청 실전송·과금 없음), false 일 때만 운영. */
export function popbillIsTest(): boolean {
  return process.env.POPBILL_IS_TEST !== "false";
}

let configured = false;
/** LinkID·SecretKey 로 1회 config. 키 없으면 명확한 에러(실호출·비용 차단). */
export function popbillConfigure(): void {
  const LinkID = process.env.POPBILL_LINK_ID;
  const SecretKey = process.env.POPBILL_SECRET_KEY;
  if (!LinkID || !SecretKey) {
    throw new Error("팝빌 연동키(POPBILL_LINK_ID·POPBILL_SECRET_KEY)가 설정되지 않았습니다.");
  }
  if (!configured) {
    popbill.config({ LinkID, SecretKey, IsTest: popbillIsTest() });
    configured = true;
  }
}

/** 콜백(success/error) API → Promise. */
export function popbillPromisify<T>(
  run: (s: (r: T) => void, e: (err: { message?: string }) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    run(resolve, (err) => reject(new Error(err?.message || "팝빌 처리 오류")));
  });
}
