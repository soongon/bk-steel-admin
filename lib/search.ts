// 목록 즉시 검색(치는 대로 좁혀지는 검색) 공통 — 정규화 키와 전화번호 숫자 매칭.
// 한글은 자모 단위로 비교해야 입력 중 조합 상태('워'→'월', '월ㄷ')에서도 결과가 끊기지 않는다.

import { digitsOnly, formatPhone } from "@/lib/format";
import { normalizePartnerName } from "@/lib/partner";

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

/** 검색 비교 키 — NFC 정리, 소문자, 공백·기호 제거(㈜→주), 한글 자모 분해. 검색어와 대상 모두 이 키로 부분일치 비교. */
export function searchKey(s: string | null | undefined): string {
  return toJamo((s ?? "").normalize("NFC").toLowerCase().replace(/㈜/g, "주").replace(/[^\p{L}\p{N}]/gu, ""));
}

/** 이름 검색 키 두 벌 — [보이는 그대로, 회사 표기((주)·주식회사 등) 뺀 것]. 검색어도 같은 함수로 만든다. */
export type NameKeys = readonly [raw: string, bare: string];
export function nameKeys(s: string | null | undefined): NameKeys {
  return [searchKey(s), searchKey(normalizePartnerName(s))];
}

/**
 * 이름 일치 — 그대로끼리('주식'까지 쳐도 '주식회사 OO'가 안 사라짐) 또는 표기 뺀 것끼리('주식회사 태웅' → '(주)태웅건설') 부분일치.
 * query 는 nameKeys(검색어). 검색어가 비면 false.
 */
export function nameMatches(target: NameKeys, query: NameKeys): boolean {
  return (query[0] !== "" && target[0].includes(query[0])) || (query[1] !== "" && target[1].includes(query[1]));
}

/** 전화번호 검색 숫자 — 검색어가 숫자·대시·공백·괄호만일 때 그 숫자. 글자가 섞이면(예: '삼성1') 전화로 보지 않고 "". */
export function phoneQueryDigits(query: string): string {
  return /^[\d\s\-().+]+$/.test(query.trim()) ? digitsOnly(query) : "";
}

/**
 * 전화번호 일치 — 번호 묶음(010·7159·4100) 시작 위치에서 이어 맞춘다: 앞자리·가운데·뒷자리 어느 묶음부터 쳐도
 * 한 자리씩 좁혀지고(중간에 결과가 비지 않음), 묶음 중간에서 시작하는 우연한 일치(054 → 010-5447)는 제외.
 * 대시로 나눌 수 없는 번호는 어디든 부분일치.
 */
export function phoneMatches(phone: string | null | undefined, queryDigits: string): boolean {
  const formatted = formatPhone(phone);
  if (!queryDigits || !formatted) return false;
  const digits = digitsOnly(formatted);
  if (!formatted.includes("-")) return digits.includes(queryDigits);
  let start = 0;
  for (const part of formatted.split("-")) {
    if (digits.startsWith(queryDigits, start)) return true;
    start += part.length;
  }
  return false;
}

/** 검색어 한 덩이의 비교 키 — 이름 키 두 벌과, 숫자로만 쳤으면 전화 숫자. */
export type QueryKeys = { name: NameKeys; phone: string };

/** 목록 검색어 — 전체(공백 무시) 키와, 띄어 쓴 단어가 2개 이상이면 단어별 키. empty 면 거르지 않는다(기호만 친 경우 등). */
export type ListQuery = { whole: QueryKeys; words: QueryKeys[]; empty: boolean };

const queryKeys = (s: string): QueryKeys => ({ name: nameKeys(s), phone: phoneQueryDigits(s) });

/**
 * 목록 검색어 만들기 — 단어에서는 회사 표기만인 것((주)·주식회사)과 기호뿐인 것을 뺀다('주식회사 OO'는 전체 이름 키가 맡는다).
 * 전체 전화 숫자도 뺀 단어로 만든다 — '(주) 4100'도 뒷자리 4100 으로 찾게.
 */
export function listQuery(query: string): ListQuery {
  const kept = query.split(/\s+/).filter((w) => nameKeys(w)[1] !== "");
  const whole: QueryKeys = { name: nameKeys(query), phone: phoneQueryDigits(kept.join(" ")) };
  const words = kept.map(queryKeys);
  return { whole, words: words.length > 1 ? words : [], empty: whole.name[0] === "" && whole.phone === "" };
}

/**
 * 목록 검색 일치 — 검색어 전체가 맞거나, 띄어 쓴 단어가 하나하나 어느 칸에든 맞으면(순서·칸 무관) 일치.
 * 사이 단어를 건너뛰거나('OO면 △△리'를 'OO △△'로) 순서를 바꾸거나 다른 칸의 단어를 섞어 쳐도 찾는다.
 * 글자를 더 칠수록 두 조건 모두 줄기만 하므로 치는 대로 좁혀지는 성질은 그대로. hit 는 행 하나가 키 하나에 맞는지.
 */
export function listMatches(q: ListQuery, hit: (k: QueryKeys) => boolean): boolean {
  return hit(q.whole) || (q.words.length > 0 && q.words.every(hit));
}
