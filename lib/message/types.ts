// 고객 메시징 어댑터 — provider-agnostic 타입. 구현: popbill.ts(문자+알림톡) / solapi.ts(문자 fallback) / mock.ts.
// 명세서/견적 이미지는 MMS, 발행·입금/연체 안내는 알림톡(템플릿). 사내 알림(카카오워크)은 별개(lib/kakaowork).

export type MmsInput = {
  corpNum?: string | null; // 팝빌 발행 사업자번호(책별 company_profile.business_no). 솔라피는 무시.
  to: string; // 수신 번호(하이픈/공백 허용 — 어댑터가 숫자만 추출)
  subject?: string;
  text: string;
  imageJpeg: Buffer; // 명세서/견적 JPEG 바이트
};

export type AlimtalkButton = {
  name: string; // 버튼명(템플릿 등록 명칭과 일치)
  type: "WL" | "AL" | "BK" | "MD" | "DS" | "BC" | "BT" | "AC"; // WL=웹링크, AL=앱링크 …
  urlMobile?: string;
  urlPc?: string;
};

export type AlimtalkInput = {
  corpNum?: string | null;
  templateCode: string; // 사전승인된 알림톡 템플릿코드
  to: string;
  content: string; // 승인 템플릿과 일치하는 본문(변수 치환 완료)
  altText?: string | null; // 대체문자 본문(알림톡 미수신 시). 없으면 대체문자 미전송.
  buttons?: AlimtalkButton[]; // 링크 URL 이 동적일 때 발송 시 주입(템플릿 버튼 매칭)
};

export type MessageResult = { ok: true; receiptNum?: string } | { ok: false; error: string };

export interface MessageProvider {
  readonly name: string;
  readonly isTest: boolean;
  sendImageMms(input: MmsInput): Promise<MessageResult>;
  sendAlimtalk(input: AlimtalkInput): Promise<MessageResult>;
  getBalance(corpNum?: string | null): Promise<number | null>;
}
