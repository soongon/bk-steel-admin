"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { digitsOnly } from "@/lib/format";
import { normalizePartnerName } from "@/lib/partner";
import { linkPartnersByBizno, linkRadarRowToPartner, unlinkRadarPartner } from "@/lib/radar/radar-data";
import {
  BIZ_TYPE_ITEM_MAX,
  bizNoConflicts,
  fillEmpty,
  isValidBizNo,
  type PartnerDocField,
  type PartnerDocView,
} from "@/lib/biz-doc";
import { addPartnerDocs, asPartnerDocKind, canWriteMasters, listPartnerDocs, partnerDocFileError } from "@/lib/partner-docs";
import type { PartnerRow } from "./partner-form-dialog";

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

/** partnerId: 저장한(레이더 [거래처로]가 기존 거래처에 연결했으면 그) 거래처 — 폼에서 고른 사업자 이미지를 이어서 올린다. */
export type PartnerActionResult =
  | { ok: true; message?: string; warning?: string; partnerId?: string }
  | { ok: false; error: string };

type PartnerInput = {
  code: string;
  name: string;
  business_no: string | null;
  representative: string | null;
  phone: string | null;
  email: string | null;
  email2: string | null;
  address: string | null;
  business_type: string | null; // 업태
  business_item: string | null; // 종목
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
    business_type: str("business_type"),
    business_item: str("business_item"),
    notes: str("notes"),
    is_active: formData.get("is_active") === "on" || formData.get("is_active") === "true",
  };
}

/** 업태·종목은 세금계산서 칸(팝빌 최대 100자)으로 나간다 — 넘으면 발행이 막히므로 저장 때 막는다. */
function bizTypeItemError(input: Pick<PartnerInput, "business_type" | "business_item">): string | null {
  if ((input.business_type?.length ?? 0) > BIZ_TYPE_ITEM_MAX) return `업태는 ${BIZ_TYPE_ITEM_MAX}자까지 적을 수 있습니다(세금계산서 칸 한도).`;
  if ((input.business_item?.length ?? 0) > BIZ_TYPE_ITEM_MAX) return `종목은 ${BIZ_TYPE_ITEM_MAX}자까지 적을 수 있습니다(세금계산서 칸 한도).`;
  return null;
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
  const lengthError = bizTypeItemError(input);
  if (lengthError) return { ok: false, error: lengthError };

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
        partnerId: found.partner.id,
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
  } else if (input.business_no) {
    // 같은 사업자번호 거래처가 이미 있으면 새로 만들지 않는다(사업자 이미지로 읽어 채운 번호 포함 — 중복 거래처 방지).
    const { data: same, error: sameErr } = await supabase
      .from("partner")
      .select("id, code, name")
      .eq("business_no", input.business_no)
      .is("deleted_at", null)
      .order("created_at")
      .limit(1);
    if (sameErr) return { ok: false, error: friendlyError(sameErr.message) };
    const hit = (same ?? [])[0] as { id: string; code: string; name: string } | undefined;
    if (hit) return { ok: false, error: `같은 사업자번호의 거래처가 이미 있습니다: ${hit.name} (${hit.code}) — 그 거래처를 수정해 주세요.` };
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
  return warning ? { ok: true, warning, partnerId: data?.id } : { ok: true, partnerId: data?.id };
}

export async function updatePartner(
  id: string,
  formData: FormData,
): Promise<PartnerActionResult> {
  const input = readPartnerInput(formData);
  if (!input.code) return { ok: false, error: "거래처 코드는 필수입니다." };
  if (!input.name) return { ok: false, error: "거래처명은 필수입니다." };
  const lengthError = bizTypeItemError(input);
  if (lengthError) return { ok: false, error: lengthError };

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

const PARTNER_COLUMNS =
  "id, code, name, business_no, representative, phone, email, email2, address, business_type, business_item, notes, is_active";

/**
 * 같은 이름(회사 표기·공백 무시)의 활성 거래처 — 이미지로 등록할 때 새로 만들지 그 거래처에 채울지 사람에게 물을 후보.
 * 사업자번호가 다른 거래처는 다른 회사라 뺀다(번호를 못 읽었으면 이름만 본다).
 */
async function findSameNamePartners(
  sb: Sb,
  name: string,
  businessNo: string | null,
): Promise<{ partners: Array<{ id: string; code: string; name: string }>; error?: string }> {
  const key = normalizePartnerName(name);
  if (!key) return { partners: [] };
  const hits: Array<{ id: string; code: string; name: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("partner")
      .select("id, code, name, business_no")
      .is("deleted_at", null)
      .order("created_at")
      .order("id")
      .range(from, from + 999);
    if (error) return { partners: [], error: error.message };
    const rows = (data ?? []) as Array<{ id: string; code: string; name: string; business_no: string | null }>;
    for (const p of rows) {
      if (normalizePartnerName(p.name) === key && (!businessNo || !p.business_no)) hits.push({ id: p.id, code: p.code, name: p.name });
    }
    if (rows.length < 1000) return { partners: hits };
  }
}

export type PartnerDocRegisterResult =
  | {
      ok: true;
      status: "created" | "filled";
      partner: PartnerRow;
      /** 기존 거래처에 채운 칸(status filled) */
      filled: PartnerDocField[];
      docs: PartnerDocView[];
      /** 올리지 못한 이미지 수 */
      docFailed: number;
      warning?: string;
    }
  | { ok: true; status: "name_match"; candidates: Array<{ id: string; code: string; name: string }> }
  /** saved: 저장은 끝났는데 그 뒤가 실패함 — 같은 요청을 다시 보내면 안 된다 */
  | { ok: false; error: string; saved?: boolean };

/**
 * 사업자 이미지로 거래처 자동 등록 — 폼(PartnerFormDialog)이 AI 인식(readPartnerDoc) 결과를 거래처 칸에 담아 이미지와 함께 보낸다.
 *  mode "auto": 같은 사업자번호 거래처가 있으면 새로 만들지 않고 그 거래처의 빈 칸만 채우고 이미지를 붙인다.
 *               없는데 같은 이름 거래처(사업자번호 없음)가 있으면 아무것도 쓰지 않고 후보를 돌려준다 — 사람이 고른다.
 *               둘 다 없으면 새로 만든다.
 *  mode "fill": target_id 거래처의 빈 칸을 채우고 이미지를 붙인다(이름 후보에서 고른 경우).
 *  mode "new" : 이름 후보를 무시하고 새로 만든다(같은 사업자번호 거래처가 있으면 그래도 그 거래처로).
 * 기존 거래처의 이름은 바꾸지 않는다(매출·매입의 표준명). 돌려준 partner·docs 로 폼이 곧바로 그 거래처 수정 화면이 된다.
 */
export async function registerPartnerFromDoc(formData: FormData): Promise<PartnerDocRegisterResult> {
  const input = readPartnerInput(formData);
  if (!formData.has("is_active")) input.is_active = true;
  const modeRaw = formData.get("mode");
  const mode = modeRaw === "fill" || modeRaw === "new" ? modeRaw : "auto";
  const targetRaw = formData.get("target_id");
  const targetId = typeof targetRaw === "string" && UUID_RE.test(targetRaw) ? targetRaw : null;
  if (!input.name) return { ok: false, error: "거래처명(상호)을 읽지 못했습니다 — 직접 입력해 주세요." };
  if (input.business_no && !isValidBizNo(input.business_no)) {
    return { ok: false, error: "사업자번호 검증번호가 맞지 않습니다 — 확인해서 직접 추가해 주세요." };
  }
  const lengthError = bizTypeItemError(input);
  if (lengthError) return { ok: false, error: lengthError };
  if (mode === "fill" && !targetId) return { ok: false, error: "채울 거래처를 고르지 않았습니다." };

  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const kinds = formData.getAll("kind");
  for (const f of files) {
    const bad = partnerDocFileError(f);
    if (bad) return { ok: false, error: bad };
  }

  const supabase = await createClient();
  if (!(await canWriteMasters(supabase))) {
    return { ok: false, error: "권한이 없습니다 — 거래처 등록은 관리자(owner·manager)만 할 수 있습니다." };
  }

  // 같은 거래처 찾기 — 고른 거래처(fill) 또는 같은 사업자번호
  let target: PartnerRow | null = null;
  if (mode === "fill") {
    const { data, error } = await supabase
      .from("partner")
      .select(PARTNER_COLUMNS)
      .eq("id", targetId as string)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { ok: false, error: friendlyError(error.message) };
    if (!data) return { ok: false, error: "고른 거래처를 찾지 못했습니다(삭제됐을 수 있음). 새로고침해 주세요." };
    target = data as PartnerRow;
    if (bizNoConflicts(target.business_no, input.business_no)) {
      return { ok: false, error: `${target.name}의 사업자번호가 이미지와 다릅니다 — 다른 회사입니다.` };
    }
    // 이 번호를 이미 쓰는 다른 거래처가 있으면 채우지 않는다(같은 사업자번호 거래처가 둘이 된다).
    if (!target.business_no && input.business_no) {
      const { data: other, error: otherErr } = await supabase
        .from("partner")
        .select("id, code, name")
        .eq("business_no", input.business_no)
        .is("deleted_at", null)
        .neq("id", target.id)
        .limit(1);
      if (otherErr) return { ok: false, error: friendlyError(otherErr.message) };
      const hit = (other ?? [])[0] as { code: string; name: string } | undefined;
      if (hit) return { ok: false, error: `같은 사업자번호의 거래처가 이미 있습니다: ${hit.name} (${hit.code}) — 그 거래처를 쓰세요.` };
    }
  } else if (input.business_no) {
    const { data, error } = await supabase
      .from("partner")
      .select(PARTNER_COLUMNS)
      .eq("business_no", input.business_no)
      .is("deleted_at", null)
      .order("created_at")
      .limit(1);
    if (error) return { ok: false, error: friendlyError(error.message) };
    target = ((data ?? [])[0] as PartnerRow | undefined) ?? null;
  }
  if (!target && mode === "auto") {
    const same = await findSameNamePartners(supabase, input.name, input.business_no);
    if (same.error) return { ok: false, error: friendlyError(same.error) };
    if (same.partners.length > 0) return { ok: true, status: "name_match", candidates: same.partners.slice(0, 5) };
  }

  let partnerId: string;
  let filled: PartnerDocField[] = [];
  if (target) {
    const fill = fillEmpty(target, input);
    filled = fill.filled;
    if (filled.length > 0) {
      const { error } = await supabase.from("partner").update(fill.patch).eq("id", target.id);
      if (error) return { ok: false, error: friendlyError(error.message) };
    }
    partnerId = target.id;
  } else {
    const payload: Partial<PartnerInput> = { ...input };
    if (!input.code) delete payload.code; // 비우면 DB 시퀀스(P-NNN)
    const { data, error } = await supabase.from("partner").insert(payload).select("id").single();
    if (error || !data) return { ok: false, error: friendlyError(error?.message ?? "거래처를 만들지 못했습니다.") };
    partnerId = data.id as string;
  }

  const docFailed = await addPartnerDocs(
    supabase,
    partnerId,
    files.map((file, i) => ({ file, kind: asPartnerDocKind(kinds[i]) })),
  );
  // 사업자번호가 새로 생겼으면 발주 레이더 ★ 연결(같은 번호 낙찰 행)
  const warning =
    input.business_no && (!target || filled.includes("business_no"))
      ? await linkRadar(supabase, partnerId, input.business_no, null)
      : null;
  bumpRevalidation();

  const [{ data: row }, docs] = await Promise.all([
    supabase.from("partner").select(PARTNER_COLUMNS).eq("id", partnerId).maybeSingle(),
    listPartnerDocs(supabase, partnerId),
  ]);
  if (!row) return { ok: false, saved: true, error: "저장은 했지만 거래처를 다시 읽지 못했습니다 — 목록을 새로고침해 주세요." };
  return {
    ok: true,
    status: target ? "filled" : "created",
    partner: row as PartnerRow,
    filled,
    docs: docs.docs,
    docFailed,
    ...(warning ? { warning } : {}),
  };
}
