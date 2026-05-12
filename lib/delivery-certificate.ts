import { type SupabaseClient } from "@supabase/supabase-js";
import { type Book } from "@/lib/book";

/**
 * 납품확인서 (Delivery Certificate).
 * 거래처+현장 단위 1회 발급. 준공검사 필수 첨부 자료.
 *
 * 발급 흐름:
 *   - 매출 상세 페이지의 [납품확인서 발급] 버튼 → issueDeliveryCertificate(sale_id)
 *   - 동일 (book, partner_id, site_name) 의 모든 미발급 sale 에 delivery_cert_id 일괄 부여
 *   - 이미 동일 조합 cert 가 있으면 그 cert 에 연결 (재발급 모달 = 동일 row 재표시)
 */
export type DeliveryCertificate = {
  id: string;
  book: Book;
  partner_id: string;
  site_name: string | null;
  doc_no: string;
  issued_on: string;
  issued_by: string | null;
  notes: string | null;
};

export async function fetchDeliveryCertById(
  supabase: SupabaseClient,
  id: string,
): Promise<DeliveryCertificate | null> {
  const { data } = await supabase
    .from("delivery_certificate")
    .select(
      "id, book, partner_id, site_name, doc_no, issued_on, issued_by, notes",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return data as DeliveryCertificate | null;
}
