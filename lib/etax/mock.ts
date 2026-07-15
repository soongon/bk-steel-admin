// 팝빌 키 미설정(로컬 개발) 시 사용하는 가짜 발행 — 실제 발행 없이 UI·DB 흐름만 검증.
// 발행 즉시 'nts_approved' + 가짜 승인번호(TEST-…) 반환. 실연동은 키 설정 시 popbill 로 전환.
import type { EtaxProvider } from "./types";

export const mockProvider: EtaxProvider = {
  name: "mock",
  isTest: true,
  async issue(input) {
    return {
      mgtKey: input.mgtKey,
      state: "nts_approved",
      ntsConfirmNum: `TEST-${input.mgtKey}`,
      raw: { mock: true },
    };
  },
  async getStatus(_corpNum, mgtKey) {
    return { state: "nts_approved", ntsConfirmNum: `TEST-${mgtKey}`, raw: { mock: true } };
  },
  async cancel(_corpNum, mgtKey) {
    return { mgtKey, state: "cancelled", ntsConfirmNum: null, raw: { mock: true } };
  },
  async getPrintUrl() {
    throw new Error("테스트(mock) 모드 — 실제 PDF가 없습니다. 팝빌 키를 설정하세요.");
  },
  async sendEmail() {
    /* mock — 무동작 */
  },
};
