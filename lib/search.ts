// 목록 즉시 검색(치는 대로 좁혀지는 검색) 공통 — 정규화 키와 전화번호 숫자 매칭.
// 한글은 자모 단위로 비교해야 입력 중 조합 상태('워'→'월', '월ㄷ')에서도 결과가 끊기지 않는다.

import { digitsOnly, formatPhone } from "@/lib/format";

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
// 겹모음·겹받침은 입력 순서대로 쪼갠다(ㅘ=ㅗ+ㅏ, ㄺ=ㄹ+ㄱ) — '고'→'과', '달'→'닭'처럼 조합 중간 상태도 부분일치.
const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅗㅏ", "ㅗㅐ", "ㅗㅣ", "ㅛ", "ㅜ", "ㅜㅓ", "ㅜㅔ", "ㅜㅣ", "ㅠ", "ㅡ", "ㅡㅣ", "ㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄱㅅ", "ㄴ", "ㄴㅈ", "ㄴㅎ", "ㄷ", "ㄹ", "ㄹㄱ", "ㄹㅁ", "ㄹㅂ", "ㄹㅅ", "ㄹㅌ", "ㄹㅍ", "ㄹㅎ", "ㅁ", "ㅂ", "ㅂㅅ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
// 낱자로 들어온 겹자모(입력기가 'ㄱ'+'ㅅ'을 'ㄳ'으로 보여 줄 때 등)도 같은 규칙으로 쪼갠다.
const SPLIT: Record<string, string> = {
  ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ", ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ",
  ㅘ: "ㅗㅏ", ㅙ: "ㅗㅐ", ㅚ: "ㅗㅣ", ㅝ: "ㅜㅓ", ㅞ: "ㅜㅔ", ㅟ: "ㅜㅣ", ㅢ: "ㅡㅣ",
};

/** 한글 음절을 자모로 분해(겹모음·겹받침 분리). 한글이 아닌 글자는 그대로. */
function toJamo(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c >= 0 && c < 11172) out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28];
    else out += SPLIT[ch] ?? ch;
  }
  return out;
}

/** 검색 비교 키 — 소문자, 공백·기호 제거(㈜→주), 한글 자모 분해. 검색어와 대상 모두 이 키로 부분일치 비교. */
export function searchKey(s: string | null | undefined): string {
  return toJamo((s ?? "").toLowerCase().replace(/㈜/g, "주").replace(/[^\p{L}\p{N}]/gu, ""));
}

/** 전화번호 검색 숫자 — 검색어가 숫자·대시·공백·괄호만일 때 그 숫자. 글자가 섞이면(예: '삼성1') 전화로 보지 않고 "". */
export function phoneQueryDigits(query: string): string {
  return /^[\d\s\-().+]+$/.test(query.trim()) ? digitsOnly(query) : "";
}

/**
 * 전화번호 일치 — 1~2자리는 앞자리만(02·01 처럼 치는 순서대로 좁혀짐), 3자리부터는 번호 묶음(010·7159·4100)
 * 시작 위치에서 이어 맞춘다(가운데·뒷자리 4개로도 찾기). 묶음 중간에서 시작하는 우연한 일치(054 → 010-5447)는 제외.
 * 대시로 나눌 수 없는 번호는 어디든 부분일치.
 */
export function phoneMatches(phone: string | null | undefined, queryDigits: string): boolean {
  const formatted = formatPhone(phone);
  if (!queryDigits || !formatted) return false;
  const digits = digitsOnly(formatted);
  if (queryDigits.length < 3) return digits.startsWith(queryDigits);
  if (!formatted.includes("-")) return digits.includes(queryDigits);
  let start = 0;
  for (const part of formatted.split("-")) {
    if (digits.startsWith(queryDigits, start)) return true;
    start += part.length;
  }
  return false;
}
