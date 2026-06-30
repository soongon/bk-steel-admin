// 솔라피(CoolSMS) 메시지 어댑터 — 문자(MMS) fallback. 기존 lib/solapi.ts 래핑.
// 알림톡은 미지원(팝빌 전용). 팝빌 발신번호 등록 전까지 명세서 MMS 가 끊기지 않게 유지.
import "server-only";
import { sendMms, getSolapiBalance } from "@/lib/solapi";
import type { MessageProvider, MmsInput, AlimtalkInput, MessageResult } from "./types";

export const solapiMessageProvider: MessageProvider = {
  name: "solapi",
  isTest: false,

  async sendImageMms(input: MmsInput): Promise<MessageResult> {
    const r = await sendMms({ to: input.to, text: input.text, subject: input.subject, imageJpeg: input.imageJpeg });
    return r.ok ? { ok: true, receiptNum: r.groupId } : { ok: false, error: r.error };
  },

  async sendAlimtalk(_input: AlimtalkInput): Promise<MessageResult> {
    return { ok: false, error: "솔라피 어댑터는 알림톡 미지원 — 팝빌 키·발신번호를 설정하세요." };
  },

  async getBalance(): Promise<number | null> {
    const b = await getSolapiBalance();
    return b ? b.balance : null;
  },
};
