// 받는 메일 주소 입력 파싱(클라이언트·서버 공용). 쉼표·세미콜론·공백·줄바꿈으로 여러 개, 중복 제거, 최대 MAX_MAIL_RECIPIENTS.

export const MAX_MAIL_RECIPIENTS = 5;

/** 메일 첨부용 문서 이미지 상한 — data URL(base64 +33%)이 서버 액션 본문 4MB 안에 들도록. */
export const MAIL_IMAGE_MAX_BYTES = 2_500_000;

/**
 * 화면 [메일 전송] 버튼 상태 — 서버 컴포넌트가 mailStatusFor() 로 계산해 내려 준다(환경변수는 서버 전용).
 * b-book: B계좌 문서는 메일로 보내지 않는다(회사 메일함에 기록이 남아 B계좌 분리 원칙에 어긋남 — 문자만).
 * mixed-books: 책이 섞인 누적 명세서(전체 보기)는 공급자를 하나로 정할 수 없어 막는다.
 */
export type MailStatus = "ready" | "unconfigured" | "b-book" | "no-company" | "mixed-books";

// 실무용 단순 검사 — 공백·꺾쇠·따옴표·쉼표 없는 local@domain.tld. (헤더 주입 방지: 줄바꿈은 구분자로 잘림)
const EMAIL_RE = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[A-Za-z]{2,}$/;

/** 주소 1개 형식 검사 — MAIL_FROM 같은 설정값 확인용. */
export const isEmailAddress = (s: string) => EMAIL_RE.test(s) && s.length <= 254;

export function parseEmails(input: string | null | undefined): { emails: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const raw of String(input ?? "").split(/[\s,;]+/)) {
    const v = raw.trim();
    if (!v) continue;
    if (!EMAIL_RE.test(v) || v.length > 254) {
      invalid.push(v);
      continue;
    }
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(v);
  }
  return { emails, invalid };
}

/** 거래처 이메일 1·2 를 받는 주소 기본값으로 — 빈 값은 건너뛴다. */
export const defaultMailTo = (...addrs: Array<string | null | undefined>) =>
  parseEmails(addrs.filter(Boolean).join(", ")).emails.join(", ");

/** 검사 결과 → 사용자 메시지(문제 없으면 null). */
export function mailToError(r: { emails: string[]; invalid: string[] }): string | null {
  if (r.invalid.length > 0) return `메일 주소를 확인하세요: ${r.invalid.slice(0, 3).join(", ")}`;
  if (r.emails.length === 0) return "받는 메일 주소를 입력하세요.";
  if (r.emails.length > MAX_MAIL_RECIPIENTS) return `받는 주소는 ${MAX_MAIL_RECIPIENTS}개까지입니다.`;
  return null;
}
