// 키 미설정(로컬 개발) 시 가짜 발송 — 실제 발송 없이 UI·DB 흐름만 검증.
import type { MessageProvider } from "./types";

export const mockMessageProvider: MessageProvider = {
  name: "mock",
  isTest: true,
  async sendImageMms() {
    return { ok: true, receiptNum: "MOCK-MMS" };
  },
  async sendAlimtalk() {
    return { ok: true, receiptNum: "MOCK-ATS" };
  },
  async getBalance() {
    return null;
  },
};
