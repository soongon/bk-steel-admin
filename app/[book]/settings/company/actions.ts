"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type Book } from "@/lib/book";

export type CompanyActionResult = { ok: true } | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("row-level security")) return "권한이 없습니다 (owner/manager 필요).";
  return message;
}

function bumpRevalidation() {
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/settings/company`);
  }
  // 거래명세서가 회사 정보를 fetch하므로 매출 상세도 무효화
  // (revalidateTag로 더 정밀하게 할 수 있지만 단순화)
}

export async function updateCompanyProfile(
  book: Book,
  formData: FormData,
): Promise<CompanyActionResult> {
  const str = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };

  const name = str("name");
  const business_no = str("business_no");
  if (!name) return { ok: false, error: "상호는 필수입니다." };
  if (!business_no) return { ok: false, error: "사업자등록번호는 필수입니다." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .upsert(
      {
        book,
        name,
        business_no,
        representative: str("representative"),
        address: str("address"),
        business_type: str("business_type"),
        business_item: str("business_item"),
        phone: str("phone"),
        fax: str("fax"),
        mobile: str("mobile"),
        email: str("email"),
        bank_default_name: str("bank_default_name"),
        bank_default_no: str("bank_default_no"),
        notes: str("notes"),
      },
      { onConflict: "book" },
    );
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true };
}
