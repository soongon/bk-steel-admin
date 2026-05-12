"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PartnerActionResult = { ok: true } | { ok: false; error: string };

type PartnerInput = {
  code: string;
  name: string;
  business_no: string | null;
  representative: string | null;
  phone: string | null;
  address: string | null;
  industry: string | null;
  notes: string | null;
  is_active: boolean;
};

function readPartnerInput(formData: FormData): PartnerInput {
  const str = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    code: (str("code") ?? "").toUpperCase(),
    name: str("name") ?? "",
    business_no: str("business_no"),
    representative: str("representative"),
    phone: str("phone"),
    address: str("address"),
    industry: str("industry"),
    notes: str("notes"),
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
  };
}

function friendlyError(message: string): string {
  if (message.includes("partner_code_key")) return "이미 사용 중인 거래처 코드입니다.";
  if (message.includes("partner_alias_alias_key")) return "이미 사용 중인 별칭입니다.";
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return message;
}

function bumpRevalidation() {
  // /[book]/partners 는 모든 책(view) 에서 같은 데이터 표시 → 책별 리프레시
  for (const book of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${book}/partners`);
  }
}

export async function createPartner(formData: FormData): Promise<PartnerActionResult> {
  const input = readPartnerInput(formData);
  if (!input.code) return { ok: false, error: "거래처 코드는 필수입니다." };
  if (!input.name) return { ok: false, error: "거래처명은 필수입니다." };

  const supabase = await createClient();
  const { error } = await supabase.from("partner").insert(input);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function updatePartner(
  id: string,
  formData: FormData,
): Promise<PartnerActionResult> {
  const input = readPartnerInput(formData);
  if (!input.code) return { ok: false, error: "거래처 코드는 필수입니다." };
  if (!input.name) return { ok: false, error: "거래처명은 필수입니다." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("partner")
    .update(input)
    .eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function deletePartner(id: string): Promise<PartnerActionResult> {
  const supabase = await createClient();
  // soft delete — audit/이력 보존
  const { error } = await supabase
    .from("partner")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}
