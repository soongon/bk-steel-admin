"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ItemActionResult = { ok: true } | { ok: false; error: string };

export type ItemCategory = "rebar" | "hbeam" | "pipe" | "scrap" | "etc";

type ItemInput = {
  code: string;
  name: string;
  category: ItemCategory;
  rebar_spec_code: string | null;
  rebar_grade_code: string | null;
  length_m: number | null;
  spec_text: string | null;
  weight_per_unit_kg: number | null;
  is_active: boolean;
};

function readItemInput(formData: FormData): ItemInput | { error: string } {
  const str = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };
  const num = (k: string) => {
    const v = str(k);
    if (v === null) return null;
    const n = Number(v.replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const categoryRaw = str("category") ?? "";
  if (!["rebar", "hbeam", "pipe", "scrap", "etc"].includes(categoryRaw)) {
    return { error: "카테고리를 선택해주세요." };
  }
  const category = categoryRaw as ItemCategory;

  const rebar_spec_code = str("rebar_spec_code");
  const rebar_grade_code = str("rebar_grade_code");
  const length_m = num("length_m");

  // rebar 카테고리: spec/grade 필수, code/name 자동 생성
  let code = (str("code") ?? "").toUpperCase();
  let name = str("name") ?? "";

  if (category === "rebar") {
    if (!rebar_spec_code) return { error: "철근 규격(spec)을 선택해주세요." };
    if (!rebar_grade_code) return { error: "철근 등급(grade)을 선택해주세요." };
    const lenLabel = length_m ? `${length_m}M` : "";
    const specClean = rebar_spec_code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    code = ["REBAR", specClean, rebar_grade_code, lenLabel].filter(Boolean).join("_");
    name = `철근 ${rebar_spec_code} ${rebar_grade_code}${length_m ? ` ${length_m}M` : ""}`;
  } else {
    if (!code) return { error: "품목 코드는 필수입니다." };
    if (!name) return { error: "품목명은 필수입니다." };
  }

  return {
    code,
    name,
    category,
    rebar_spec_code: category === "rebar" ? rebar_spec_code : null,
    rebar_grade_code: category === "rebar" ? rebar_grade_code : null,
    length_m: category === "rebar" ? length_m : null,
    spec_text: category === "rebar" ? null : str("spec_text"),
    weight_per_unit_kg: num("weight_per_unit_kg"),
    is_active:
      formData.get("is_active") === "on" || formData.get("is_active") === "true",
  };
}

function friendlyError(message: string): string {
  if (message.includes("item_code_key")) return "이미 사용 중인 품목 코드입니다.";
  if (message.includes("chk_rebar_consistency"))
    return "철근은 spec/grade/length 가 일관성 있게 채워져야 합니다.";
  if (message.includes("row-level security"))
    return "권한이 없습니다 (owner/manager 필요).";
  return message;
}

function bumpRevalidation() {
  for (const book of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${book}/items`);
    revalidatePath(`/${book}/sales`);
    revalidatePath(`/${book}/purchases`);
  }
}

export async function createItem(formData: FormData): Promise<ItemActionResult> {
  const parsed = readItemInput(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("item").insert(parsed);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function updateItem(
  id: string,
  formData: FormData,
): Promise<ItemActionResult> {
  const parsed = readItemInput(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("item").update(parsed).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function deleteItem(id: string): Promise<ItemActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("item")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}
