"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SiteActionResult = { ok: true } | { ok: false; error: string };

type SiteInput = {
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  client_name: string | null;
  status: "active" | "closed";
  started_on: string | null;
  ended_on: string | null;
  notes: string | null;
  is_active: boolean;
};

function readSiteInput(formData: FormData): SiteInput {
  const str = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  };
  const status = (str("status") ?? "active") as "active" | "closed";
  return {
    code: (str("code") ?? "").toUpperCase(),
    name: str("name") ?? "",
    address: str("address"),
    city: str("city"),
    client_name: str("client_name"),
    status: status === "closed" ? "closed" : "active",
    started_on: str("started_on"),
    ended_on: str("ended_on"),
    notes: str("notes"),
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
  };
}

function friendlyError(message: string): string {
  if (message.includes("site_code_key")) return "이미 사용 중인 현장 코드입니다.";
  if (message.includes("uq_site_name")) return "이미 등록된 현장명입니다.";
  if (message.includes("row-level security")) return "권한이 없습니다 (owner/manager 필요).";
  return message;
}

function bumpRevalidation() {
  for (const book of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${book}/sites`);
    revalidatePath(`/${book}/sales`);
  }
}

export async function createSite(formData: FormData): Promise<SiteActionResult> {
  const input = readSiteInput(formData);
  if (!input.name) return { ok: false, error: "현장명은 필수입니다." };

  const payload: Partial<SiteInput> = { ...input };
  if (!input.code) delete payload.code;

  const supabase = await createClient();
  const { error } = await supabase.from("site").insert(payload);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function updateSite(
  id: string,
  formData: FormData,
): Promise<SiteActionResult> {
  const input = readSiteInput(formData);
  if (!input.code) return { ok: false, error: "현장 코드는 필수입니다." };
  if (!input.name) return { ok: false, error: "현장명은 필수입니다." };

  const supabase = await createClient();
  const { error } = await supabase.from("site").update(input).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function deleteSite(id: string): Promise<SiteActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("site")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}
