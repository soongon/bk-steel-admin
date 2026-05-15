"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SalesLogActionResult = { ok: true } | { ok: false; error: string };

type SalesLogInput = {
  contacted_on: string;
  partner_id: string | null;
  prospect_name: string | null;
  contact_person: string | null;
  channel: string | null;
  result: string | null;
  follow_up_on: string | null;
  notes: string | null;
  business_card_id: string | null;
};

function readInput(formData: FormData): SalesLogInput {
  const str = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    contacted_on: str("contacted_on") ?? "",
    partner_id: str("partner_id"),
    prospect_name: str("prospect_name"),
    contact_person: str("contact_person"),
    channel: str("channel"),
    result: str("result"),
    follow_up_on: str("follow_up_on"),
    notes: str("notes"),
    business_card_id: str("business_card_id"),
  };
}

function friendlyError(message: string): string {
  if (message.includes("row-level security")) return "권한이 없습니다.";
  if (message.includes("violates foreign key")) return "선택한 거래처가 유효하지 않습니다.";
  return message;
}

function bumpRevalidation() {
  for (const book of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${book}/sales-log`);
    revalidatePath(`/${book}/business-cards`);   // 명함 카드의 영업 카운트 갱신
  }
}

function validate(input: SalesLogInput): string | null {
  if (!input.contacted_on) return "접촉일은 필수입니다.";
  if (!input.partner_id && !input.prospect_name) {
    return "등록 거래처를 선택하거나 잠재 거래처명을 입력하세요.";
  }
  return null;
}

export async function createSalesLog(formData: FormData): Promise<SalesLogActionResult> {
  const input = readInput(formData);
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("sales_log").insert({
    ...input,
    created_by: user?.id ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function updateSalesLog(
  id: string,
  formData: FormData,
): Promise<SalesLogActionResult> {
  const input = readInput(formData);
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const supabase = await createClient();
  const { error } = await supabase.from("sales_log").update(input).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}

export async function deleteSalesLog(id: string): Promise<SalesLogActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sales_log")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  bumpRevalidation();
  return { ok: true };
}
