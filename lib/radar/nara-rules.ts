/**
 * 관급(나라장터) 순수 규칙 — 권역 판정 · 공종 라벨 · 철근 관련성(RC) · 연락처 유효성.
 *
 * 수집기(naraBid.ts)·정리 스크립트(radar-v2-cleanup)·측정 스크립트(radar-v2-measure)·화면 규칙(v2-rules)이
 * 같은 함수를 쓴다. 부수효과 없음(테스트: scripts/radar-v2-check.ts).
 *
 * 기획안: docs/발주_레이더_v2_기획.md §4.2 · §7 / 데이터감사 §2 · 노이즈 §A-2·§A-5·§D
 *
 * 원칙(기획안 §3-3): 수집 단계 컷은 "비공사"뿐. 공종은 라벨(rc · civil · non_steel)로만 남기고
 * 화면/규칙에서 거른다 — 제목 키워드로 컷하면 전화번호가 있는 civil 낙찰사 계정 이력이 사라진다.
 */

import type { RadarRegion } from "./types";

// ── 공통 유틸 ─────────────────────────────────────────────────
export const digits = (s: unknown): string => String(s ?? "").replace(/[^0-9]/g, "");

/** 낙찰사 전화 유효성 — 마스킹('*') 없음 ∧ 숫자 9~11자리. (1,064/1,112 [확인]) */
export function telValid(v: unknown): boolean {
  const s = String(v ?? "");
  if (s.includes("*")) return false;
  const d = digits(s);
  return d.length >= 9 && d.length <= 11;
}

/**
 * 전화번호 비교 키 — 형식(대시·공백·괄호·전각 숫자·국가번호 +82) 무시한 국내 번호 숫자.
 * 마스킹·자릿수 이상이면 null(어떤 번호와도 같지 않음). 문자 발송 어댑터는 숫자만 뽑아 보내므로 같은 번호를 같은 키로 본다.
 */
export function phoneKey(v: unknown): string | null {
  const s = String(v ?? "").normalize("NFKC");
  if (s.includes("*")) return null;
  let d = digits(s);
  if (d.startsWith("82") && d.length >= 10 && d.length <= 12) d = `0${d.slice(2)}`;
  return d.length >= 9 && d.length <= 11 && d.startsWith("0") ? d : null;
}

/**
 * 저장된 번호(stored)가 받는 번호 키(key)와 같은가 — 한 칸에 번호를 여러 개 이어 적었거나 내선을 붙여 숫자만 12자리 이상으로
 * 저장된 값은 그 안에 key 가 들어 있으면 같은 번호로 본다(보수적: 문자 가드가 더 막는 쪽). 마스킹 값은 어떤 번호와도 다르다.
 */
export function phoneMatches(stored: unknown, key: string): boolean {
  const k = phoneKey(stored);
  if (k) return k === key;
  const s = String(stored ?? "").normalize("NFKC");
  if (s.includes("*")) return false;
  const d = digits(s);
  return d.length > 11 && d.includes(key);
}

// ── 권역 판정 ─────────────────────────────────────────────────
/**
 * 텍스트 → 권역. 부분문자열 버그 수정판:
 *  - '울주' 단독은 안 잡음('서울주택도시개발공사' 오판 23행) → '울주군' 또는 '울산'(단, '서울산…' 제외)
 *  - '포항'은 앞에 한글이 없을 때만('삼천포항·다대포항·격포항' 등 타지역 항구 오판 31행).
 *    예외(붙여 쓴 포항 기관명): 경상북도포항교육지원청(28행)·서포항농협·폴리텍대학포항캠퍼스, 구룡포·영일만.
 *  - 감포(경주시 감포읍) — 제목이 '감포항 …'뿐이고 발주처가 광역(해양수산청)이어도 경주.
 */
export function regionFromText(text: string | null | undefined): RadarRegion | null {
  if (!text) return null;
  const s = String(text);
  if (s.includes("경주") || s.includes("감포")) return "gyeongju";
  if (/(^|[^가-힣]|북도|경북|대학|서)포항|구룡포|영일만/.test(s)) return "pohang";
  if (/(^|[^서])울산|울주군|(^|[^가-힣])울주/.test(s)) return "ulsan"; // '서울주택'은 앞이 한글이라 제외
  return null;
}

/** 권역 밖 지명(제목에 있고 권역어가 없으면 타지역 공사). 노이즈 감사 §A-5. 매칭은 otherPlaceIn(경계 규칙)으로만. */
export const OTHER_PLACES = [
  "울진", "영덕", "청송", "영천", "경산", "대구", "통영", "고성", "거제", "사천", "창원", "남해", "하동",
  "부산", "양산", "밀양", "김해", "서울", "위례", "고덕", "중랑", "내곡", "강일", "동대구", "안동", "구미",
  "김천", "상주", "문경", "영주", "봉화", "의성", "군위", "칠곡", "성주", "고령", "청도", "울릉", "진주",
  "함안", "창녕", "삼천포", "진해", "마산",
];

/**
 * 광역·타지역 발주처 — 발주처명만으로 권역을 정하면 안 되는 기관(현장이 전국·전도에 흩어짐).
 * 이 발주처는 제목(또는 공고 현장지역)에 권역어가 있어야 적재한다.
 */
export const BROAD_ORG =
  /서울주택|국토관리|철도공사|철도시설|도로공사|수자원공사|토지주택|LH|경남지역본부|경남본부|교육청$|해양수산|환경공단|가스공사|전력공사/;

/**
 * 권역 지자체(시·구·군청과 그 산하 사업소·울산시교육청·경주/포항 교육지원청) — 관할 밖 발주가 거의 없어
 * 제목의 타지역 토큰보다 우선한다('불국 하동소하천'(경주시)·'공영주차장'(울산 남구) 오판 방지).
 */
export const LOCAL_ORG =
  /^(경상북도\s*(경주시|포항시)|울산광역시|(경상북도교육청\s*)?경상북도(경주|포항)교육지원청)/;

/**
 * 타지역 지명 경계 매칭 — 앞에 한글이 없고(단어 시작) 뒤에 행정·지구 접미사나 비한글이 올 때만.
 * 부분문자열 매칭은 '공영주차장'⊃영주·'노상주차장'⊃상주·'고령자'⊃고령·'하동소하천'⊃하동을 타지역으로 오판했다.
 */
const OTHER_PLACE_RE = new RegExp(
  `(^|[^가-힣])(${OTHER_PLACES.join("|")})(?=시|군|구|읍|면|항|지구|특별|광역|도(?![가-힣])|[^가-힣]|$)`,
);
export function otherPlaceIn(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(OTHER_PLACE_RE);
  return m ? m[2] : null;
}

export interface RegionInput {
  /** 입찰공고 cnstrtsiteRgnNm(현장지역) — 있으면 최우선. 281/281 채움 [확인] */
  siteRegion?: string | null;
  title?: string | null;
  /** 발주처(dminsttNm·ntceInsttNm). 광역 발주처는 제목 권역어 필수. */
  orderingOrg?: string | null;
}

/**
 * 권역 판정 v2. 순서: 현장지역 → 제목 → (지역 발주처만) 발주처. 어디에도 없으면 null(=적재 안 함).
 *  - 현장지역이 있는데 권역어가 없고 시·군 단위로 다른 곳이면 타지역 → null.
 *    (시도만 적힌 '경상북도'·'울산광역시'는 제목·발주처로 내려감.)
 *  - 제목에 타지역 지명이 있고 권역어가 없으면 null.
 */
export function matchRegionV2(input: RegionInput): RadarRegion | null {
  const site = (input.siteRegion ?? "").trim();
  if (site) {
    const r = regionFromText(site);
    if (r) return r;
    if (!/^(경상북도|울산광역시)$/.test(site)) return null; // 서울특별시·부산광역시 등 = 타지역
  }
  const title = input.title ?? "";
  const fromTitle = regionFromText(title);
  if (fromTitle) return fromTitle;
  const org = (input.orderingOrg ?? "").trim();
  if (LOCAL_ORG.test(org)) return regionFromText(org); // 권역 지자체 발주 = 권역(제목 타지역 토큰보다 우선)
  if (otherPlaceIn(title)) return null;
  if (BROAD_ORG.test(org)) return null;
  return regionFromText(org);
}

/**
 * 기존 적재 행의 권역 오판 의심(정리 스크립트용). 노이즈 감사 §A-5 휴리스틱 이식 — 60/1,393 [확인].
 * 반환: 사유 문자열 또는 null(정상).
 */
export function regionSuspect(
  row: { title: string | null; ordering_org: string | null },
  /** 입찰공고 현장지역(raw.cnstrtsiteRgnNm) — 수집기가 최우선으로 쓰는 기준. 있으면 그것으로 판정한다. */
  siteRegion?: string | null,
): string | null {
  const site = (siteRegion ?? "").trim();
  if (site) {
    if (regionFromText(site)) return null; // 현장지역이 권역 = 정상(제목에 '대구'가 있어도 효자동 지점 등)
    if (!/^(경상북도|울산광역시)$/.test(site)) return `현장지역 타지역(${site})`;
  }
  const t = row.title ?? "";
  const o = row.ordering_org ?? "";
  if (/서울주택/.test(o) || /서울주택/.test(t)) return "울주⊂서울주택 버그";
  // regionFromText 와 같은 판정: 감포항·구룡포·서포항·북도/경북/대학+포항은 권역, 삼천포항·다대포항 등만 의심
  if (/[가-힣]포항/.test(t) && regionFromText(t) === null && !/포항/.test(o)) return "xx포항(타지역 항구)";
  // 광역 발주처(국토관리사무소·해양수산청…)의 권역어는 증거로 치지 않는다 — matchRegionV2 와 같은 기준
  const orgTok = BROAD_ORG.test(o) && !LOCAL_ORG.test(o) ? null : regionFromText(o);
  const hasRegionTok = regionFromText(t) !== null || orgTok !== null;
  const other = otherPlaceIn(t);
  if (other && !hasRegionTok) return `타지역 지명(${other}) · 권역어 없음`;
  return null;
}

/** 낙찰사 주소(bidwinnrAdrs) → 소재 권역. */
export function addrRegion(addr: unknown): RadarRegion | "other" {
  return regionFromText(String(addr ?? "")) ?? "other";
}

// ── 공종 라벨 ─────────────────────────────────────────────────
/**
 * 비공사(수집 컷 유일 기준): 설계·감리·용역·임대·매각·측량·진단·점검.
 * 예외: '설계·시공 일괄'(턴키 공사)과 '임대주택'(LH·개발공사 RC 대형)은 공사다.
 */
export const NON_CONSTRUCTION = /설계(?!\s*[·ㆍ.,및]?\s*시공)|감리|용역|임대(?!\s*주택)|매각|측량|진단|점검/;

/** 분리발주 공종 괄호 표기 — "(소방)·(전기)…" = 철근 무관. */
export const PAREN_TRADE = /\((기계|전기|소방|통신|조경|설비|승강기|정보통신|기계설비)\)/;

/** 비철근 공종어(제목 어디든). '소방'이 v1 NARA_EXCLUDE에 없어 "신축 소방공사"가 building으로 잡혔다. */
export const EXCL_TRADE = [
  "소방", "전기", "통신", "조경", "승강기", "기계설비", "설비공사", "냉난방", "냉방", "난방", "태양광", "신재생",
  "LED", "led", "조명", "수배전반", "전력", "전주", "가로등", "신호등", "CCTV", "cctv", "방송", "음향", "소화",
  "스프링클러", "엘리베이터", "자동문", "랩부스",
];

/**
 * 비철근 작업(v1 수집 컷 목록 중 공종 외 작업어) — 라벨 non_steel, 전화 탭 제외.
 * v2 는 수집 단계에서 자르지 않고 라벨로 남기므로(기획안 §3-3) 화면 규칙이 이 목록으로 거른다 —
 * 빠뜨리면 산불예방 숲가꾸기·포장·준설 업체가 '경주 활동 토건사'로 전화 목록에 섞인다(재수집 후 32→44계정 확인).
 */
export const NON_STEEL_WORK = [
  "식재", "수목", "청소", "소독", "방역", "방제", "제초", "산림유역", "산림경영", "산불예방", "산불진화", "산불방지", "조림", "숲가꾸기", "풀베기",
  "덩굴제거", "육림", "간벌", "벌채", "가지치기", "묘목", "임도", "사방", "준설", "퇴적", "오니", "방수", "도장", "포장",
  "아스팔트", "아스콘", "표지", "제설", "벌목", "간판", "현수막", "석면", "폐기물", "지장물", "슬레이트",
];

/** 유지·정비·비구조 작업어 — 양성(RC) 판정에서 제외. '보강토'는 먼저 치환해 '보강'과 충돌 회피. */
export const EXCL_WORK = [
  "포장", "아스팔트", "아스콘", "도색", "도장", "페인트", "방수", "방충", "방음", "차선", "표지", "노면", "블럭",
  "블록", "횡단보도", "방지턱", "안전시설", "난간", "가드레일", "펜스", "휀스", "울타리", "데크", "벽화", "경관",
  "간판", "현수막", "안내판", "제설", "청소", "소독", "방역", "방제", "제초", "벌목", "벌채", "간벌", "숲가꾸기",
  "조림", "풀베기", "식재", "수목", "묘목", "잔디", "임도", "사방", "준설", "퇴적", "오니", "석면", "폐기물",
  "설계", "감리", "측량", "용역", "임대", "매각", "점검", "진단", "정비", "개보수", "보수", "보강", "개선",
  "유지", "관리", "교체", "리모델링", "수선", "관로", "급수관", "송수관", "배수관", "상수관", "하수관", "오수관",
  "우수관", "맨홀", "펌프", "밸브", "제수변", "제수문", "수문", "계량기", "급수", "소화전", "양수", "가압장",
  "슬러지", "보일러", "그늘막", "쉼터", "벤치", "파고라", "의자", "담장", "창호", "샷시", "샤시", "유리",
  "지붕", "외벽", "천장", "바닥", "내부", "인테리어", "도배", "장판", "타일", "싱크", "화장실", "변기", "주방",
  "환기", "에어컨", "셔터", "간이", "임시", "응급", "긴급복구", "복구", "덮개", "차수", "흙막이", "굴착",
  "부대", "진입로", "농로", "용수로", "용수관", "용수", "철거", "해체", "멸실", "지장물", "차양", "캐노피",
  "막구조", "텐트", "놀이", "운동기구", "체육시설", "인조", "우레탄", "탄성", "무대", "조형물", "상징",
  "기념비", "안내", "표시", "도로안전", "교통", "주차면", "주차선", "구획", "마감", "미장", "석재", "판넬",
  "패널", "샌드위치", "경량", "컨테이너", "조립식", "임시가설", "비계", "둘레길", "산책로", "걷기길",
  "안전대책", "안전계단", "제조구매", "구매설치", "저장소", "탈수기", "초목", "잡목", "예초", "관정", "커팅",
];

/** 신축어 × 건물유형 = 건축(RC 多). */
export const NEWBUILD = ["신축", "증축", "개축", "재축", "건립", "설립", "신설", "증설", "건설공사", "건축공사", "축조"];
export const BUILDING_TYPE = [
  "청사", "회관", "센터", "학교", "교사", "체육관", "강당", "도서관", "병원", "보건", "어린이집", "유치원",
  "복지관", "사옥", "관사", "기숙사", "생활관", "주택", "아파트", "공장", "창고", "주차장", "박물관", "미술관",
  "문화", "청소년", "경로당", "마을회관", "급식", "수영장", "체육", "임대주택", "행복주택", "작업장", "판매장",
  "직판장", "휴게소", "터미널", "화장장", "추모", "장례", "소방서", "파출소", "경찰서", "보건소", "전시관",
  "체험관", "연수원", "훈련", "캠프", "요양", "복지", "어울림", "다목적", "공공건축", "건축물", "숙소", "연구동",
  "연구소", "교육관", "교육센터", "하우스", "공동이용",
];
/** 구조물 × 신설/개체 동사 = 구조토목(RC). '조성'은 둘레길·공원 때문에 제외. */
export const STRUCT = [
  "교량", "교각", "육교", "고가", "옹벽", "암거", "박스", "지하차도", "터널", "배수장", "정수장", "취수장",
  "펌프장", "저수지", "보강토", "호안", "방음벽", "사면", "배수로", "수로", "구조물", "소교량", "세월교", "제방",
  "배수지", "하수처리장", "하수처리시설", "교대", "방파제", "물양장", "선착장", "부두", "안벽", "잔교", "저류조",
  "저류지", "침사지", "배수구조물", "통로박스", "수로박스", "우수관거",
];
export const STRUCT_ACTION = ["신설", "설치", "개체", "개축", "재가설", "확장", "축조", "건설", "신축", "증설"];

const norm = (title: string) => title.replace(/\s+/g, " ");
/**
 * 공사 범위 나열 괄호 제거 — '(건축,가시설,토목,조경,기계)'처럼 건축·토목을 포함한 통합 발주 범위는 분리발주 공종이 아니다.
 * 그대로 두면 안의 '조경'·'기계설비'가 비철근 공종으로 잡혀 RC 건립 낙찰(예: 115억 지식산업센터)이 non_steel 이 됐다.
 * 단일 공종 괄호 '(소방)'·'(전기)'(PAREN_TRADE)는 건드리지 않는다.
 */
const stripScopeParens = (t: string) => t.replace(/\([^)]*(건축|토목)[^)]*\)/g, " ");
/**
 * 작업어 판정용 치환 — 건물·시설 이름 안의 작업어가 오판되지 않게:
 * '보강토'(⊃보강)·'임대주택'(⊃임대)·'설계·시공'(⊃설계)·'청소년'(⊃청소)·'태권도장'(⊃도장)·'수목원'(⊃수목).
 */
const forWork = (t: string) =>
  t
    .replace(/보강토/g, "BGT")
    .replace(/임대\s*주택|행복주택/g, "HSG")
    .replace(/설계\s*[·ㆍ.,및]?\s*시공(\s*일괄)?/g, "DNB")
    .replace(/청소년/g, "YTH")
    .replace(/(태권|검|유|합기)도장/g, "DOJ")
    .replace(/수목원/g, "ARB");

/** 제목에 비철근 공종어가 있는가(분리발주 괄호 + 공종어). */
export function hasNonSteelTrade(text: string): boolean {
  const t = norm(text);
  if (PAREN_TRADE.test(t)) return true;
  const tt = forWork(stripScopeParens(t));
  return EXCL_TRADE.some((k) => tt.includes(k));
}

/** 제목에 비철근 작업어(숲가꾸기·포장·준설·지장물…)가 있는가. */
export function hasNonSteelWork(text: string): boolean {
  const tt = forWork(stripScopeParens(norm(text)));
  return NON_STEEL_WORK.some((k) => tt.includes(k));
}

/**
 * 철근콘크리트 공사(RC) 양성 규칙 — strict v2. 정밀도 81%·재현율 100%는 단일 판정자 라벨 기준 [추정].
 * 라벨(▸RC)과 전화 탭 B규칙에만 쓰고 수집 컷에는 쓰지 않는다.
 */
export function isRcTitle(title: string): boolean {
  const t = norm(title);
  if (hasNonSteelTrade(t)) return false;
  const tt = forWork(stripScopeParens(t));
  const work = EXCL_WORK.some((k) => tt.includes(k));
  if (work) return false;
  if (NEWBUILD.some((k) => t.includes(k)) && BUILDING_TYPE.some((k) => t.includes(k))) return true;
  if (STRUCT.some((k) => t.includes(k)) && STRUCT_ACTION.some((k) => t.includes(k))) return true;
  return false;
}

/** 관급 공종 라벨 3값 — usage 컬럼에 저장. */
export type NaraLabel = "rc" | "civil" | "non_steel";
export const NARA_LABELS: readonly NaraLabel[] = ["rc", "civil", "non_steel"] as const;

/**
 * 공고명(+주공종) → 라벨. 비공사면 null(수집 컷).
 *  - cnstwkType(mtltyAdvcPsblYnCnstwkNm, 예 "전문공사-유지보수공사")에 '유지보수'가 있으면 RC 아님(라벨 입력, 컷 아님).
 */
export function naraLabel(text: string, cnstwkType?: string | null): NaraLabel | null {
  const t = norm(text);
  if (NON_CONSTRUCTION.test(t)) return null;
  if (hasNonSteelTrade(t)) return "non_steel";
  const maintenance = /유지보수/.test(cnstwkType ?? "");
  // RC 판정을 작업어 판정보다 먼저 — 작업어 목록에만 있는 단어(산림유역·가지치기·슬레이트…)가 RC 신축을 강등하지 않게
  if (!maintenance && isRcTitle(t)) return "rc";
  if (hasNonSteelWork(t)) return "non_steel";
  return "civil";
}

/**
 * 낙찰사명 기준 비철근 업종(전화 탭 제외). '디자인·건축·하우징'은 제외하지 않는다 —
 * 이후건축디자인·YJ건축·예가하우징이 실거래처다. '전설·산전'은 전기설비업(봉진전설·태백전설).
 */
export const NON_STEEL_NAME =
  /조경|정원|산림|전기|전력|전설|산전|소방|통신|안전|문화유산|금속제작|설비|도장|방수|청소|정보|시스템|플랜트|인테리어|솔라|에너지|환경/;
