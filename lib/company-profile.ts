import { type Book } from "@/lib/book";

/**
 * 거래명세표·세금계산서 등 외부 발급 문서의 공급자(우리) 정보.
 *
 * v1: 임시값 하드코딩. 정식 운영 전 실제 사업자등록증·법인등기 정보로 교체.
 * v2: company_profile 테이블로 이동 + 어드민 설정 페이지에서 편집 가능하게.
 *
 * 책별 분리: 법인(bk)과 사업자(sl)는 별도 사업자번호·헤더. B계좌(b)는 무자료라 발행 X.
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

export const COMPANY_PROFILE: Record<Book, CompanyProfile | null> = {
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
  sl: {
    name: "SL철강",
    business_no: "111-11-11111",
    representative: "(사업자 대표자)",
    address: "경상북도 경주시 (사업장 주소)",
    business_type: "도매 및 소매업",
    business_item: "철강재",
    phone: "054-111-1111",
    mobile: "010-1111-1111",
  },
  b: null, // B계좌 매출은 무자료라 거래명세표 발행 대상 아님
};

export function getCompanyProfile(book: Book): CompanyProfile | null {
  return COMPANY_PROFILE[book];
}
