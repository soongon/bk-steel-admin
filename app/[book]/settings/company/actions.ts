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

  // 인감 이미지 업로드 (선택) — File 있으면 Storage 업로드 후 publicUrl 받기
  let stampUrl: string | undefined = undefined;
  const stampFile = formData.get("stamp_file");
  const stampClear = formData.get("stamp_clear") === "true";
  if (stampFile instanceof File && stampFile.size > 0) {
    if (stampFile.size > 1024 * 1024) {
      return { ok: false, error: "인감 이미지는 1MB 이하여야 합니다." };
    }
    const ext = (stampFile.name.split(".").pop() ?? "png").toLowerCase();
    const rand = Math.random().toString(36).slice(2, 8);
    const path = `${book}/${Date.now()}-${rand}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("company-stamps")
      .upload(path, stampFile, {
        contentType: stampFile.type || "image/png",
        upsert: false,
      });
    if (upErr) return { ok: false, error: friendly(upErr.message) };
    const { data: pub } = supabase.storage.from("company-stamps").getPublicUrl(path);
    stampUrl = pub.publicUrl;
  } else if (stampClear) {
    stampUrl = "";   // 빈 문자열 → null로 정리
  }

  const payload: Record<string, unknown> = {
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
  };
  if (stampUrl !== undefined) {
    payload.stamp_url = stampUrl === "" ? null : stampUrl;
  }

  const { error } = await supabase
    .from("company_profile")
    .upsert(payload, { onConflict: "book" });
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true };
}
