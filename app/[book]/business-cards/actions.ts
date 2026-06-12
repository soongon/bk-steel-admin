"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { digitsOnly } from "@/lib/format";

export type BusinessCardActionResult = { ok: true; id?: string } | { ok: false; error: string };

type Input = {
  collected_on: string | null;
  partner_id: string | null;
  name: string;
  title: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

function readInput(formData: FormData): Input {
  const str = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };
  const digits = (k: string) => {
    const v = str(k);
    const d = v ? digitsOnly(v) : "";
    return d || null;
  };
  return {
    collected_on: str("collected_on"),
    partner_id: str("partner_id"),
    name: str("name") ?? "",
    title: str("title"),
    company: str("company"),
    phone: digits("phone"),
    email: str("email"),
    address: str("address"),
    notes: str("notes"),
  };
}

function friendly(message: string): string {
  if (message.includes("row-level security")) return "권한이 없습니다.";
  if (message.includes("violates foreign key")) return "선택한 거래처가 유효하지 않습니다.";
  return message;
}

function bumpRevalidation() {
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/business-cards`);
  }
}

export async function createBusinessCard(formData: FormData): Promise<BusinessCardActionResult> {
  const input = readInput(formData);
  if (!input.name) return { ok: false, error: "이름은 필수입니다." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_card")
    .insert(input)
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id: data.id };
}

export async function updateBusinessCard(
  id: string,
  formData: FormData,
): Promise<BusinessCardActionResult> {
  const input = readInput(formData);
  if (!input.name) return { ok: false, error: "이름은 필수입니다." };

  const supabase = await createClient();
  const { error } = await supabase.from("business_card").update(input).eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id };
}

export async function deleteBusinessCard(id: string): Promise<BusinessCardActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("business_card")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };

  bumpRevalidation();
  return { ok: true, id };
}
