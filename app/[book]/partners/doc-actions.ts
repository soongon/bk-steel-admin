"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { BizDocOcrError, bizDocOcrConfigured, readBizDocImage } from "@/lib/biz-doc-ocr";
import { docKindOf, pickCounterparty, type BizDocType, type PartnerDocKind, type PartnerDocView, type PartyPick } from "@/lib/biz-doc";
import {
  addPartnerDocs,
  asPartnerDocKind,
  canWriteMasters,
  fetchOwnCompanies,
  listPartnerDocs,
  partnerDocFileError,
  removePartnerDocs,
} from "@/lib/partner-docs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN = "권한이 없습니다 — 거래처 등록·수정은 관리자(owner·manager)만 할 수 있습니다.";

export type PartnerDocReadResult =
  | { ok: true; docType: BizDocType; kind: PartnerDocKind; pick: PartyPick; note: string | null }
  | { ok: false; code: "not_configured" | "forbidden" | "failed"; error: string };

/**
 * 사업자 이미지 AI 인식 — 저장 없이 읽기만 한다. 서류의 사업자 중 우리 회사(회사 정보의 사업자번호)를 뺀 쪽을 거래처로 고른다.
 * 키(ANTHROPIC_API_KEY)가 없으면 not_configured — 폼은 이미지만 붙여 두고 직접 입력으로 넘어간다.
 * 비용이 드는 호출이라 거래처를 고칠 수 있는 사람(owner·manager)만.
 */
export async function readPartnerDoc(formData: FormData): Promise<PartnerDocReadResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, code: "failed", error: "이미지가 없습니다." };
  const bad = partnerDocFileError(file);
  if (bad) return { ok: false, code: "failed", error: bad };
  if (!bizDocOcrConfigured()) {
    return { ok: false, code: "not_configured", error: "이미지 자동 인식이 설정되지 않았습니다(ANTHROPIC_API_KEY)." };
  }

  const supabase = await createClient();
  if (!(await canWriteMasters(supabase))) return { ok: false, code: "forbidden", error: FORBIDDEN };
  try {
    const [reading, own] = await Promise.all([
      readBizDocImage({ data: await file.arrayBuffer(), mediaType: file.type }),
      fetchOwnCompanies(supabase),
    ]);
    return {
      ok: true,
      docType: reading.docType,
      kind: docKindOf(reading.docType),
      pick: pickCounterparty(reading, own),
      note: reading.note,
    };
  } catch (e) {
    if (e instanceof BizDocOcrError) return { ok: false, code: e.code, error: e.message };
    return { ok: false, code: "failed", error: "이미지를 읽지 못했습니다 — 다시 올려 주세요." };
  }
}

export type PartnerDocListResult = { ok: true; docs: PartnerDocView[] } | { ok: false; error: string };

/** 거래처 수정 화면의 사업자 이미지 — 서명 URL(1시간)로. */
export async function listPartnerDocsAction(partnerId: string): Promise<PartnerDocListResult> {
  if (!UUID_RE.test(partnerId)) return { ok: false, error: "잘못된 거래처입니다." };
  const supabase = await createClient();
  const { docs, error } = await listPartnerDocs(supabase, partnerId);
  return error ? { ok: false, error: "사업자 이미지를 불러오지 못했습니다." } : { ok: true, docs };
}

export type PartnerDocSyncResult = { ok: true; failed: number } | { ok: false; error: string };

/**
 * 거래처 저장 뒤 사업자 이미지 반영 — 뺀 이미지 삭제 + 새 이미지 업로드를 한 번에(서버에서 동시에).
 * formData: partner_id, remove_id(여러 개), file(여러 개) + 같은 순서의 kind. failed = 반영하지 못한 장 수.
 * 클라이언트는 서버 액션을 하나씩 차례로 보내므로 장마다 부르지 말고 묶어서(3MB 단위) 보낸다.
 */
export async function syncPartnerDocs(formData: FormData): Promise<PartnerDocSyncResult> {
  const partnerId = formData.get("partner_id");
  if (typeof partnerId !== "string" || !UUID_RE.test(partnerId)) return { ok: false, error: "잘못된 거래처입니다." };
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const kinds = formData.getAll("kind");
  const removeIds = formData.getAll("remove_id").filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
  for (const f of files) {
    const bad = partnerDocFileError(f);
    if (bad) return { ok: false, error: bad };
  }
  if (files.length === 0 && removeIds.length === 0) return { ok: true, failed: 0 };

  const supabase = await createClient();
  if (!(await canWriteMasters(supabase))) return { ok: false, error: FORBIDDEN };
  const { data: partner, error } = await supabase
    .from("partner")
    .select("id")
    .eq("id", partnerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!partner) return { ok: false, error: "거래처를 찾지 못했습니다(삭제됐을 수 있음)." };

  // 빼기 먼저(자리를 비운 뒤 상한 안에서 올린다)
  const removeFailed = await removePartnerDocs(supabase, partnerId, removeIds);
  const addFailed = await addPartnerDocs(
    supabase,
    partnerId,
    files.map((file, i) => ({ file, kind: asPartnerDocKind(kinds[i]) })),
  );
  revalidatePath("/[book]/partners", "page"); // 목록의 이미지 표시
  return { ok: true, failed: removeFailed + addFailed };
}
