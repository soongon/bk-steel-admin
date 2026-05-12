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
  notes: string | null;
};

/**
 * B 책은 SL 사업자의 무자료 흐름이라 명세서·세금계산서 등 외부 문서는 SL 정보로 발행.
 * 운영자는 SL row 한 곳만 관리하면 BK/SL/B 모두 일관 — 별도 동기화 불필요.
 */
function effectiveBook(book: Book): Book {
  return book === "b" ? "sl" : book;
}

/** 단일 책의 회사 정보 fetch (B는 자동으로 SL 사용) */
export async function fetchCompanyProfile(
  supabase: SupabaseClient,
  book: Book,
): Promise<CompanyProfile | null> {
  const target = effectiveBook(book);
  const { data } = await supabase
    .from("company_profile")
    .select(
      "book, name, business_no, representative, address, business_type, business_item, phone, fax, mobile, email, bank_default_name, bank_default_no, stamp_url, notes",
    )
    .eq("book", target)
    .maybeSingle();
  return data as CompanyProfile | null;
}

/** 3개 책 정보 한번에 fetch (어드민 페이지용) */
export async function fetchAllCompanyProfiles(
  supabase: SupabaseClient,
): Promise<CompanyProfile[]> {
  const { data } = await supabase
    .from("company_profile")
    .select(
      "book, name, business_no, representative, address, business_type, business_item, phone, fax, mobile, email, bank_default_name, bank_default_no, stamp_url, notes",
    )
    .order("book");
  return (data ?? []) as CompanyProfile[];
}
