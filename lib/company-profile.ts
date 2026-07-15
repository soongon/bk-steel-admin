import { type SupabaseClient } from "@supabase/supabase-js";
import { type Book } from "@/lib/book";

/**
 * 거래명세표·세금계산서 등 외부 발급 문서의 공급자(우리) 정보.
 *
 * 저장: DB의 company_profile 테이블 (마이그레이션 0029)
 * 책별 row (bk / sl / b). 초기엔 sl == b (B계좌도 실질 SL 사업자 운영)
 * 어드민 페이지: /[book]/settings/company
 *
 * 거래명세서 ≠ 세금계산서:
 *   - 거래명세서: 거래 내용 증빙 (자료/무자료 무관)
 *   - 세금계산서: 부가세 신고 자료 (자료 거래에서만)
 */
export type CompanyProfile = {
  book: Book;
  name: string;
  business_no: string;
  representative: string | null;
  address: string | null;
  business_type: string | null;
  business_item: string | null;
  phone: string | null;
  fax: string | null;
  mobile: string | null;
  email: string | null;
  bank_default_name: string | null;
  bank_default_no: string | null;
  stamp_url: string | null;
  bank_copy_url: string | null; // 통장(계좌) 사본 이미지
  notes: string | null;
};

const COMPANY_COLS =
  "book, name, business_no, representative, address, business_type, business_item, phone, fax, mobile, email, bank_default_name, bank_default_no, stamp_url, bank_copy_url, notes";

/**
 * 단일 책의 회사 정보 fetch.
 * B계좌는 SL 사업자의 무자료 흐름이지만 입금 계좌·계좌사본은 히든 통장(SL 공식계좌와 다름) →
 * B row 를 우선 사용하고, 미설정이면 SL 로 폴백(상호·사업자번호 등은 SL과 동일하게 관리).
 */
export async function fetchCompanyProfile(
  supabase: SupabaseClient,
  book: Book,
): Promise<CompanyProfile | null> {
  const { data } = await supabase
    .from("company_profile")
    .select(COMPANY_COLS)
    .eq("book", book)
    .maybeSingle();
  const row = data as CompanyProfile | null;
  if (book !== "b") return row;

  // B계좌: SL과 같은 사업자라 상호·사업자번호·인감은 SL 공유. B는 입금계좌·계좌사본만 별도.
  // b row 없으면 전체 SL, 있으면 b 우선 + 비어있는 필드(특히 인감)는 SL 폴백.
  const { data: slData } = await supabase
    .from("company_profile")
    .select(COMPANY_COLS)
    .eq("book", "sl")
    .maybeSingle();
  const sl = slData as CompanyProfile | null;
  if (!row) return sl;
  if (!sl) return row;
  return {
    ...row,
    // 텍스트/인감은 b값 우선, 없으면 SL 폴백(계좌·계좌사본은 b값 그대로 — 히든 통장).
    name: row.name || sl.name,
    business_no: row.business_no || sl.business_no,
    representative: row.representative ?? sl.representative,
    address: row.address ?? sl.address,
    business_type: row.business_type ?? sl.business_type,
    business_item: row.business_item ?? sl.business_item,
    phone: row.phone ?? sl.phone,
    fax: row.fax ?? sl.fax,
    mobile: row.mobile ?? sl.mobile,
    email: row.email ?? sl.email,
    stamp_url: row.stamp_url ?? sl.stamp_url,
  };
}

/** 3개 책 정보 한번에 fetch (어드민 페이지용) */
export async function fetchAllCompanyProfiles(
  supabase: SupabaseClient,
): Promise<CompanyProfile[]> {
  const { data } = await supabase.from("company_profile").select(COMPANY_COLS).order("book");
  return (data ?? []) as CompanyProfile[];
}
