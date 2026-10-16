"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type Book, isValidBook } from "@/lib/book";
import { isLeadSource } from "@/lib/lead-source";

export type PurchaseQuoteActionResult = { ok: true; id?: string } | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("doc_no")) return "이미 사용 중인 견적번호입니다.";
  if (message.includes("chk_pq_bk_documented")) return "법인 매입견적은 자료거래(부가세 별도)만 가능합니다.";
  if (message.includes("chk_pq_b_undocumented")) return "B계좌 매입견적은 무자료만 가능합니다.";
  if (message.includes("chk_pq_line_price_positive")) return "단가(원/kg)는 0보다 커야 합니다.";
  if (message.includes("chk_pq_lead_source")) return "유입경로 값이 올바르지 않습니다.";
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
}

const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

// 견적번호(PQ{YYYYMMDD}-NNN)는 DB 가 채번(next_purchase_quote_doc_no, 0076) — 앱의 count 채번은 RLS 가시 범위만 세어
// 책 권한이 제한된 사용자에게 UNIQUE 충돌이 났다.

type LineInput = {
  item_id: string | null;
  display_name: string;
  spec_text: string | null;
  price_per_kg_krw: number;
  notes: string | null;
};

function readInput(formData: FormData) {
  const str = (k: string) => (formData.get(k) as string | null)?.trim() ?? "";
  const bookStr = str("book");
  if (!isValidBook(bookStr)) return { error: "책(법인/사업자/B계좌)을 선택해주세요." };
  const book: Book = bookStr;
  const quote_date = str("quote_date");
  if (!quote_date) return { error: "견적일을 입력해주세요." };

  let lines: LineInput[];
  try {
    const raw = JSON.parse(str("lines") || "[]") as unknown[];
    lines = raw.map((l) => {
      const o = l as Record<string, unknown>;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return {
        item_id: typeof o.item_id === "string" && uuid.test(o.item_id) ? o.item_id : null,
        display_name: typeof o.display_name === "string" ? o.display_name.trim() : "",
        spec_text: typeof o.spec_text === "string" && o.spec_text.trim() ? o.spec_text.trim() : null,
        price_per_kg_krw: Math.round(Number(o.price_per_kg_krw) || 0), // 원 단위 정수(톤당 환산 ×1,000 과 일치)
        notes: typeof o.notes === "string" && o.notes.trim() ? o.notes.trim() : null,
      };
    });
  } catch {
    return { error: "품목 데이터를 읽지 못했습니다." };
  }
  if (lines.length === 0) return { error: "품목을 1개 이상 추가해주세요." };
  for (const l of lines) {
    if (!l.display_name) return { error: "품목명을 입력해주세요." };
    if (l.price_per_kg_krw <= 0) return { error: "단가(원/kg)를 입력해주세요." };
  }

  // 책별 룰: 법인은 자료거래만(부가세 별도), B계좌는 무자료만. DB CHECK 와 동일하게 서버에서도 강제.
  let is_documented = str("is_documented") !== "false";
  if (book === "bk") is_documented = true;
  if (book === "b") is_documented = false;

  // 유입경로(0079) — 목록 밖 값은 버린다(미기록). 메모는 경로가 있을 때만.
  const leadRaw = str("lead_source");
  const lead_source = isLeadSource(leadRaw) ? leadRaw : null;
  const lead_note = lead_source ? str("lead_note") || null : null;

  return {
    book,
    doc_no: str("doc_no") || undefined,
    partner_id: str("partner_id") || null,
    prospect_name: str("prospect_name") || null,
    site_id: str("site_id") || null,
    site_name: str("site_name") || null,
    quote_date,
    valid_until: str("valid_until") || null,
    is_documented,
    weighing_terms: str("weighing_terms") || null,
    delivery_terms: str("delivery_terms") || null,
    payment_terms: str("payment_terms") || null,
    notes: str("notes") || null,
    lead_source,
    lead_note,
    lines,
  };
}

export async function createPurchaseQuote(formData: FormData): Promise<PurchaseQuoteActionResult> {
  const parsed = readInput(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error ?? "입력 오류" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_quote_with_lines", {
    p_quote: {
      book: parsed.book,
      doc_no: parsed.doc_no ?? null, // null 이면 DB 채번
      partner_id: parsed.partner_id,
      prospect_name: parsed.prospect_name,
      site_id: parsed.site_id,
      site_name: parsed.site_name,
      quote_date: parsed.quote_date,
      valid_until: parsed.valid_until,
      is_documented: parsed.is_documented,
      weighing_terms: parsed.weighing_terms,
      delivery_terms: parsed.delivery_terms,
      payment_terms: parsed.payment_terms,
      notes: parsed.notes,
      lead_source: parsed.lead_source,
      lead_note: parsed.lead_note,
      status: "draft",
    },
    p_lines: parsed.lines,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath(`/${parsed.book}/purchase-quotes`);
  revalidatePath(`/all/purchase-quotes`);
  return { ok: true, id: data as string };
}

export async function updatePurchaseQuote(id: string, formData: FormData): Promise<PurchaseQuoteActionResult> {
  const parsed = readInput(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error ?? "입력 오류" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_purchase_quote_with_lines", {
    p_quote_id: id,
    p_quote: {
      partner_id: parsed.partner_id,
      prospect_name: parsed.prospect_name,
      site_id: parsed.site_id,
      site_name: parsed.site_name,
      quote_date: parsed.quote_date,
      valid_until: parsed.valid_until,
      is_documented: parsed.is_documented,
      weighing_terms: parsed.weighing_terms,
      delivery_terms: parsed.delivery_terms,
      payment_terms: parsed.payment_terms,
      notes: parsed.notes,
      lead_source: parsed.lead_source,
      lead_note: parsed.lead_note,
    },
    p_lines: parsed.lines,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath(`/${parsed.book}/purchase-quotes`);
  revalidatePath(`/all/purchase-quotes`);
  revalidatePath(`/${parsed.book}/purchase-quotes/${id}`);
  return { ok: true, id };
}

/** 발송 표시 — status='sent', sent_on(최초 1회). */
export async function markPurchaseQuoteSent(id: string, book: string): Promise<PurchaseQuoteActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_quote")
    .update({ status: "sent", sent_on: kstToday() })
    .eq("id", id)
    .is("sent_on", null)
    .select("id");
  if (error) return { ok: false, error: friendly(error.message) };
  if (!data || data.length === 0) return { ok: false, error: "권한이 없거나 이미 발송 처리된 견적입니다." };
  revalidatePath(`/${book}/purchase-quotes`);
  revalidatePath(`/all/purchase-quotes`);
  revalidatePath(`/${book}/purchase-quotes/${id}`);
  return { ok: true };
}

/**
 * 매입 완료 표시 — 계근 후 매입(purchase) 메뉴에서 실중량으로 등록한 뒤 이 견적을 닫는다(status='done').
 * kg 매입은 실중량 필수(chk_kg_unit_actual_required)라 견적에서 자동 전환하지 않는다.
 */
export async function markPurchaseQuoteDone(id: string, book: string): Promise<PurchaseQuoteActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_quote")
    .update({ status: "done", done_on: kstToday() })
    .eq("id", id)
    .in("status", ["draft", "sent"])
    .select("id");
  if (error) return { ok: false, error: friendly(error.message) };
  if (!data || data.length === 0) return { ok: false, error: "권한이 없거나 이미 완료된 견적입니다." };
  revalidatePath(`/${book}/purchase-quotes`);
  revalidatePath(`/all/purchase-quotes`);
  revalidatePath(`/${book}/purchase-quotes/${id}`);
  return { ok: true };
}

/** 삭제 (soft). */
export async function deletePurchaseQuote(id: string, book: string): Promise<PurchaseQuoteActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_quote")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, error: friendly(error.message) };
  if (!data || data.length === 0) return { ok: false, error: "권한이 없거나 이미 삭제된 견적입니다." };
  revalidatePath(`/${book}/purchase-quotes`);
  revalidatePath(`/all/purchase-quotes`);
  return { ok: true };
}
