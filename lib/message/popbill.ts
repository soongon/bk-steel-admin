// 팝빌(Popbill) 메시지 어댑터 — 문자(MessageService.sendMMS)·알림톡(KakaoService.sendATS_one).
// 세금계산서(lib/etax/popbill)와 동일 LinkHub 계정·키·IsTest 게이트 공유. 발신번호=POPBILL_SENDER.
// CorpNum(발행 사업자번호)은 호출자가 input.corpNum 으로 전달(책별 company_profile.business_no).
// (server-only 미사용 — node: 임포트가 이미 클라 번들을 차단. lib/etax/popbill 과 동일. index 경유 시 solapi 가 가드.)
// ⚠️ SDK 팩토리(MessageService/KakaoService)가 this(모듈 객체)에 캐싱 → frozen ESM namespace 로 부르면
// 프로덕션에서 undefined 반환. createRequire 로 mutable CJS exports 를 받는다(lib/etax/popbill 과 동일).
import { createRequire } from "node:module";

const popbill = createRequire(import.meta.url)("popbill") as typeof import("popbill");
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { digitsOnly } from "@/lib/format";
import type { MessageProvider, MmsInput, AlimtalkInput, MessageResult } from "./types";

function isTest(): boolean {
  return process.env.POPBILL_IS_TEST !== "false"; // 기본 테스트베드
}

let configured = false;
function ensureConfig(): void {
  const LinkID = process.env.POPBILL_LINK_ID;
  const SecretKey = process.env.POPBILL_SECRET_KEY;
  if (!LinkID || !SecretKey) {
    throw new Error("팝빌 연동키(POPBILL_LINK_ID·POPBILL_SECRET_KEY)가 설정되지 않았습니다.");
  }
  if (!configured) {
    popbill.config({ LinkID, SecretKey, IsTest: isTest() });
    configured = true;
  }
}

/** 콜백(success/error) API → Promise. */
function promisify<T>(run: (s: (r: T) => void, e: (err: { message?: string }) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    run(resolve, (err) => reject(new Error(err?.message || "팝빌 처리 오류")));
  });
}

function senderNo(): string {
  return digitsOnly(process.env.POPBILL_SENDER ?? "");
}

export const popbillMessageProvider: MessageProvider = {
  name: "popbill",
  get isTest() {
    return isTest();
  },

  // 명세서/견적 이미지 MMS(포토문자). solapi 처럼 임시파일 경유(SDK 가 FilePath 기반).
  async sendImageMms(input: MmsInput): Promise<MessageResult> {
    const corpNum = digitsOnly(input.corpNum ?? "");
    if (!corpNum) return { ok: false, error: "발행 사업자번호(corpNum)가 없습니다 — 회사 정보를 확인하세요." };
    const sender = senderNo();
    if (!sender) {
      return { ok: false, error: "POPBILL_SENDER(발신번호) 미설정 — 팝빌에 발신번호 등록 후 설정하세요." };
    }
    const to = digitsOnly(input.to);
    if (to.length < 10) return { ok: false, error: "수신 전화번호가 올바르지 않습니다." };

    ensureConfig();
    const svc = popbill.MessageService();
    const tmp = join(tmpdir(), `statement-${randomUUID()}.jpg`);
    try {
      await writeFile(tmp, input.imageJpeg);
      const receiptNum = await promisify<string>((s, e) =>
        svc.sendMMS(corpNum, sender, to, "", input.subject ?? "", input.text, tmp, "", s, e),
      );
      return { ok: true, receiptNum };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "MMS 발송 실패" };
    } finally {
      await unlink(tmp).catch(() => {});
    }
  },

  // 알림톡(사전승인 템플릿). 미수신 시 대체문자(altText) 자동 — altSendType 'C'(직접입력).
  async sendAlimtalk(input: AlimtalkInput): Promise<MessageResult> {
    const corpNum = digitsOnly(input.corpNum ?? "");
    if (!corpNum) return { ok: false, error: "발행 사업자번호(corpNum)가 없습니다." };
    if (!input.templateCode) return { ok: false, error: "알림톡 템플릿코드가 없습니다." };
    const sender = senderNo();
    if (!sender) return { ok: false, error: "POPBILL_SENDER(발신번호) 미설정." };
    const to = digitsOnly(input.to);
    if (to.length < 10) return { ok: false, error: "수신 전화번호가 올바르지 않습니다." };

    ensureConfig();
    const svc = popbill.KakaoService();
    const alt = input.altText?.trim() || "";
    const altSendType = alt ? "C" : ""; // C=대체문자 직접, 공백=미전송
    const btns = (input.buttons ?? []).map((b) => ({
      n: b.name,
      t: b.type,
      u1: b.urlMobile ?? "",
      u2: b.urlPc ?? "",
    }));
    try {
      const receiptNum = await promisify<string>((s, e) =>
        svc.sendATS_one(
          corpNum,
          input.templateCode,
          sender,
          input.content,
          alt,
          altSendType,
          "",
          to,
          "",
          "",
          "",
          btns.length ? btns : null,
          s,
          e,
        ),
      );
      return { ok: true, receiptNum };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "알림톡 발송 실패" };
    }
  },

  async getBalance(corpNum?: string | null): Promise<number | null> {
    const cn = digitsOnly(corpNum ?? "");
    if (!cn) return null;
    try {
      ensureConfig();
      const svc = popbill.MessageService();
      return await promisify<number>((s, e) => svc.getBalance(cn, s, e));
    } catch {
      return null;
    }
  },
};
