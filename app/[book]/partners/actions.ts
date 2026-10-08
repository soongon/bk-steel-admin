"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { digitsOnly } from "@/lib/format";
import { normalizePartnerName } from "@/lib/partner";
import { linkPartnersByBizno, linkRadarRowToPartner, unlinkRadarPartner } from "@/lib/radar/radar-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sb = Awaited<ReturnType<typeof createClient>>;

/**
 * 거래처 저장 후 발주 레이더 연결(★) — 거래처 저장은 이미 끝났으므로 실패는 경고로 돌려준다.
 *  fromRadarId: [거래처로]의 그 행(낙찰이면 같은 사업자번호 계정) · businessNo: 같은 번호 낙찰 행 자동 연결.
 */
async function linkRadar(sb: Sb, partnerId: string, businessNo: string | null, fromRadarId: string | null): Promise<string | null> {
  let warning: string | null = null;
  try {
    if (fromRadarId) {
      const r = await linkRadarRowToPartner(sb, fromRadarId, partnerId);
      if (r.error) warning = `레이더 연결(★) 실패: ${r.error}`;
    }
    if (businessNo) await linkPartnersByBizno(sb, { bizno: businessNo });
  } catch (e) {
    warning = `레이더 연결(★) 실패: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (fromRadarId || businessNo) revalidatePath("/radar");
  return warning;
}

/**
 * [거래처로] 중복 방지 — 같은 사업자번호, 또는 같은 이름((주)·주식회사·공백 무시)이면서 사업자번호가 충돌하지 않는
 * 활성 거래처를 찾는다(여럿이면 가장 먼저 만든 것 — resolvePartnerId 관례).
 */
async function findExistingPartner(
  sb: Sb,
  name: string,
  businessNo: string | null,
): Promise<{ partner: { id: string; code: string; name: string } | null; error?: string }> {
  if (businessNo) {
    const { data, error } = await sb
      .from("partner")
      .select("id, code, name")
      .eq("business_no", businessNo)
      .is("deleted_at", null)
      .order("created_at")
      .limit(1);
    if (error) return { partner: null, error: error.message };
    if (data?.[0]) return { partner: data[0] };
  }
  const key = normalizePartnerName(name);
  if (!key) return { partner: null };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("partner")
      .select("id, code, name, business_no")
      .is("deleted_at", null)
      .order("created_at")
      .order("id")
      .range(from, from + 999);
    if (error) return { partner: null, error: error.message };
    const rows = (data ?? []) as Array<{ id: string; code: string; name: string; business_no: string | null }>;
    const hit = rows.find(
      (p) => normalizePartnerName(p.name) === key && (!businessNo || !p.business_no || p.business_no === businessNo),
    );
    if (hit) return { partner: { id: hit.id, code: hit.code, name: hit.name } };
    if (rows.length < 1000) return { partner: null };
  }
}

export type PartnerActionResult = { ok: true; message?: string; warning?: string } | { ok: false; error: string };

type PartnerInput = {
  code: string;
  name: string;
  business_no: string | null;
  representative: string | null;
  phone: string | null;
  email: string | null;
  email2: string | null;
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
  // 사업자번호·전화는 숫자만 저장 (표시는 lib/format 으로 포맷)
  const digits = (k: string) => {
    const v = str(k);
    const d = v ? digitsOnly(v) : "";
    return d || null;
  };
  return {
    code: (str("code") ?? "").toUpperCase(),
    name: str("name") ?? "",
    business_no: digits("business_no"),
    representative: str("representative"),
    phone: digits("phone"),
    email: str("email"),
    email2: str("email2"),
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
    revalidatePath(`/${book}/business-cards`);   // 명함 페이지의 거래처 매핑 표시 갱신
  }
}

export async function createPartner(formData: FormData): Promise<PartnerActionResult> {
  const input = readPartnerInput(formData);
  if (!input.name) return { ok: false, error: "거래처명은 필수입니다." };

  // 명함에서 이관된 경우 — 신규 partner 생성 후 business_card.partner_id 자동 매핑
  const fromCard = formData.get("from_card");
  const fromCardId = typeof fromCard === "string" && fromCard ? fromCard : null;
  // 발주 레이더에서 이관된 경우 — 신규 partner 생성(출처 source_project_id) 후 레이더 행 linked_partner_id 연결
  const fromRadar = formData.get("from_radar");
  const fromRadarId = typeof fromRadar === "string" && UUID_RE.test(fromRadar) ? fromRadar : null;

  // 코드 비어있으면 DB 시퀀스로 자동 생성 → insert payload에서 제거
  const payload: Partial<PartnerInput> & { source_project_id?: string } = { ...input };
  if (!input.code) delete payload.code;

  const supabase = await createClient();

  // 레이더 [거래처로] — 같은 이름·사업자번호 거래처가 이미 있으면 새로 만들지 않고 그 거래처에 연결(마스터 중복 방지)
  if (fromRadarId) {
    const found = await findExistingPartner(supabase, input.name, input.business_no);
    if (found.error) return { ok: false, error: friendlyError(found.error) };
    if (found.partner) {
      const r = await linkRadarRowToPartner(supabase, fromRadarId, found.partner.id);
      revalidatePath("/radar");
      if (r.error) return { ok: false, error: `기존 거래처 ${found.partner.name}(${found.partner.code})에 연결하지 못했습니다: ${r.error}` };
      bumpRevalidation();
      return {
        ok: true,
        message: `기존 거래처 ${found.partner.name}(${found.partner.code})에 연결했습니다 — 새 거래처는 만들지 않았습니다.`,
      };
    }
    // 새로 만드는 거래처 — 출처 레이더 행을 남긴다(0074: 문자 가드가 레이더에서 만든 거래처를 기존 거래처와 구분, 판정 집계)
    const { data: src, error: srcErr } = await supabase
      .from("construction_project")
      .select("id")
      .eq("id", fromRadarId)
      .maybeSingle();
    if (srcErr) return { ok: false, error: friendlyError(srcErr.message) };
    if (!src) return { ok: false, error: "출처 레이더 행을 찾지 못했습니다. 레이더 화면을 새로고침한 뒤 다시 시도하세요." };
    payload.source_project_id = fromRadarId;
  }

  const { data, error } = await supabase
    .from("partner")
    .insert(payload)
    .select("id")
    .single();
  if (error) return { ok: false, error: friendlyError(error.message) };

  if (fromCardId && data) {
    // 역방향 매핑은 best-effort — 실패해도 partner는 이미 생성됨
    await supabase
      .from("business_card")
      .update({ partner_id: data.id })
      .eq("id", fromCardId);
  }
  const warning = data ? await linkRadar(supabase, data.id, input.business_no, fromRadarId) : null;

  bumpRevalidation();
  return warning ? { ok: true, warning } : { ok: true };
}

export async function updatePartner(
  id: string,
  formData: FormData,
): Promise<PartnerActionResult> {
  const input = readPartnerInput(formData);
  if (!input.code) return { ok: false, error: "거래처 코드는 필수입니다." };
  if (!input.name) return { ok: false, error: "거래처명은 필수입니다." };

  const supabase = await createClient();
  const { data: before } = await supabase.from("partner").select("business_no").eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("partner")
    .update(input)
    .eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  // 사업자번호를 바꾸거나 지우면 이전 번호로 걸린 ★(낙찰 행)를 풀고, 그 번호의 다른 거래처가 있으면 그쪽으로 다시 연결.
  let warning: string | null = null;
  const oldNo = before?.business_no ? digitsOnly(before.business_no) : null;
  if (oldNo && oldNo !== input.business_no) {
    try {
      await unlinkRadarPartner(supabase, id, oldNo);
      await linkPartnersByBizno(supabase, { bizno: oldNo });
      revalidatePath("/radar");
    } catch (e) {
      warning = `이전 사업자번호의 레이더 연결(★) 정리 실패: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (input.business_no) warning = (await linkRadar(supabase, id, input.business_no, null)) ?? warning;

  bumpRevalidation();
  return warning ? { ok: true, warning } : { ok: true };
}

export async function deletePartner(id: string): Promise<PartnerActionResult> {
  const supabase = await createClient();
  const { data: before } = await supabase.from("partner").select("business_no").eq("id", id).maybeSingle();
  // soft delete — audit/이력 보존
  const { error } = await supabase
    .from("partner")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };

  // 레이더 ★ 정리 — 삭제한 거래처에 걸린 연결을 풀고, 같은 사업자번호의 다른 거래처가 있으면 그쪽으로 다시 연결.
  let warning: string | null = null;
  try {
    const n = await unlinkRadarPartner(supabase, id);
    if (before?.business_no) await linkPartnersByBizno(supabase, { bizno: before.business_no });
    if (n > 0) revalidatePath("/radar");
  } catch (e) {
    warning = `레이더 연결(★) 해제 실패: ${e instanceof Error ? e.message : String(e)}`;
  }

  bumpRevalidation();
  return warning ? { ok: true, warning } : { ok: true };
}
