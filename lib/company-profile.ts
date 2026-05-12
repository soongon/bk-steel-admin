import { type Book } from "@/lib/book";

/**
 * 거래명세표·세금계산서 등 외부 발급 문서의 공급자(우리) 정보.
 *
 * v1: 임시값 하드코딩. 정식 운영 전 실제 사업자등록증·법인등기 정보로 교체.
 * v2: company_profile 테이블로 이동 + 어드민 설정 페이지에서 편집 가능하게.
 *
 * 책별 분리:
 *   - 법인(bk): 새 법인 사업자번호 + 헤더
 *   - 사업자(sl): 친구 개인사업자 정보
 *   - B계좌(b): SL 사업자가 실질 운영. 명세서는 SL 명의로 발행하되 세금계산서 미발행(무자료) 표기
 *
 * 거래명세서 ≠ 세금계산서:
 *   - 거래명세서: 거래 내용 증빙 (자료/무자료 무관, 모든 매출에 발행 가능)
 *   - 세금계산서: 부가세 신고 자료 (자료 거래에서만 발행)
 */
export type CompanyProfile = {
  name: string;
  business_no: string; // 사업자등록번호 (xxx-xx-xxxxx)
  representative: string;
  address: string;
  business_type: string; // 업태
  business_item: string; // 종목
  phone: string;
  fax?: string;
  mobile?: string;
  email?: string;
};

// SL철강 (친구 개인사업자) — sl과 b 책 모두 실질 운영 주체.
// 명세서 발행 시 동일 사업자 정보 사용 (B계좌는 무자료 표기로 구분).
const SL_PROFILE: CompanyProfile = {
  name: "SL철강",
  business_no: "111-11-11111",
  representative: "(사업자 대표자)",
  address: "경상북도 경주시 (사업장 주소)",
  business_type: "도매 및 소매업",
  business_item: "철강재",
  phone: "054-111-1111",
  mobile: "010-1111-1111",
};

export const COMPANY_PROFILE: Record<Book, CompanyProfile> = {
  bk: {
    name: "BK철강 주식회사",
    business_no: "000-00-00000",
    representative: "(법인 대표자)",
    address: "경상북도 경주시 (사업장 주소)",
    business_type: "도매 및 소매업",
    business_item: "철강재 / 형강 / 철근",
    phone: "054-000-0000",
    fax: "054-000-0001",
    mobile: "010-0000-0000",
    email: "info@bk-steel.example",
  },
  sl: SL_PROFILE,
  b: SL_PROFILE,
};

export function getCompanyProfile(book: Book): CompanyProfile {
  return COMPANY_PROFILE[book];
}
