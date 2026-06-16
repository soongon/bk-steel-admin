"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeVat } from "@/lib/transaction";
import { type Book } from "@/lib/book";

export type QuoteActionResult = { ok: true; id?: string } | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("doc_no")) return "이미 사용 중인 견적번호입니다.";
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
}

/** 견적번호 자동 생성 — Q{YYYYMMDD}-NNN. race 는 UNIQUE 로 catch. */
async function generateQuoteDocNo(quoteDate: string): Promise<string> {
  const supabase = await createClient();
  const datePart = quoteDate.replace(/-/g, "");
  const { count } = await supabase
    .from("quote")
    .select("id", { count: "exact", head: true })
    .like("doc_no", `Q${datePart}-%`);
  return `Q${datePart}-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

type QuoteLineInput = {
  item_id: string;
  unit: string;
  qty: number;
  unit_price_krw: number;
  weight_kg: number | null;
};

function readQuoteInput(formData: FormData) {
  const str = (k: string) => (formData.get(k) as string | null)?.trim() ?? "";
  const bookStr = str("book");
  if (!bookStr || bookStr === "all") return { error: "책(법인/사업자/B계좌)을 선택해주세요." };
  const book = bookStr as Book;
  const quote_date = str("quote_date");
  if (!quote_date) return { error: "견적일을 입력해주세요." };

  let lines: QuoteLineInput[];
  try {
    const raw = JSON.parse(str("lines") || "[]") as unknown[];
    lines = raw.map((l) => {
      const o = l as Record<string, unknown>;
      const w = o.weight_kg;
      return {
        item_id: String(o.item_id ?? ""),
        unit: String(o.unit ?? ""),
        qty: Number(o.qty) || 0,
        unit_price_krw: Number(o.unit_price_krw) || 0,
        weight_kg: w != null && w !== "" ? Number(w) : null,
      };
    });
  } catch {
    return { error: "품목 데이터를 읽지 못했습니다." };
  }
  if (lines.length === 0) return { error: "품목을 1개 이상 추가해주세요." };
  for (const l of lines) {
    if (!l.item_id) return { error: "품목을 선택해주세요." };
    if (!l.unit) return { error: "단위를 선택해주세요." };
    if (l.qty <= 0) return { error: "수량을 입력해주세요." };
    if (l.unit_price_krw <= 0) return { error: "단가를 입력해주세요." };
  }

  // 견적은 거래처·현장 둘 다 optional(잠재 고객은 prospect_name 만). 무자료(부가세 제외) 토글.
  const is_documented = str("is_documented") !== "false";
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
    delivery_terms: str("delivery_terms") || null,
    payment_terms: str("payment_terms") || null,
    notes: str("notes") || null,
    lines,
  };
}

export async function createQuote(formData: FormData): Promise<QuoteActionResult> {
  const parsed = readQuoteInput(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error ?? "입력 오류" };

  const supabase = await createClient();
  const docNo = parsed.doc_no ?? (await generateQuoteDocNo(parsed.quote_date));

  const lines = parsed.lines.map((l) => ({
    item_id: l.item_id,
    unit: l.unit,
    qty: l.qty,
    unit_price_krw: l.unit_price_krw,
    weight_kg: l.weight_kg,
    line_subtotal_krw: l.weight_kg
      ? Math.round(l.unit_price_krw * l.weight_kg)
      : Math.round(l.unit_price_krw * l.qty),
  }));
  const subtotal = lines.reduce((s, l) => s + l.line_subtotal_krw, 0);
  // 무자료면 부가세 제외, 자료면 표준 10%
  const { vatType, vatRate, vat, total } = computeVat(
    parsed.is_documented,
    parsed.is_documented ? "tax_invoice_electronic" : "none",
    subtotal,
  );

  const { data, error } = await supabase.rpc("create_quote_with_lines", {
    p_quote: {
      book: parsed.book,
      doc_no: docNo,
      partner_id: parsed.partner_id,
      prospect_name: parsed.prospect_name,
      site_id: parsed.site_id,
      site_name: parsed.site_name,
      quote_date: parsed.quote_date,
      valid_until: parsed.valid_until,
      is_documented: parsed.is_documented,
      vat_type: vatType,
      vat_rate: vatRate,
      subtotal_krw: subtotal,
      vat_krw: vat,
      total_krw: total,
      status: "draft",
      delivery_terms: parsed.delivery_terms,
      payment_terms: parsed.payment_terms,
      notes: parsed.notes,
    },
    p_lines: lines,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath(`/${parsed.book}/quotes`);
  return { ok: true, id: data as string };
}

/** 발송 표시 — status='sent', sent_on(최초 1회). */
export async function markQuoteSent(id: string, book: string): Promise<QuoteActionResult> {
  const supabase = await createClient();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const { error } = await supabase
    .from("quote")
    .update({ status: "sent", sent_on: today })
    .eq("id", id)
    .is("sent_on", null);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath(`/${book}/quotes`);
  return { ok: true };
}

/** 견적 삭제 (soft). */
export async function deleteQuote(id: string, book: string): Promise<QuoteActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("quote")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath(`/${book}/quotes`);
  return { ok: true };
}
