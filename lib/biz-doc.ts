/**
 * 거래처 사업자 이미지(계산서·사업자등록증 사진) — 공용 타입·순수 헬퍼(서버·클라이언트 공용).
 * AI 인식(lib/biz-doc-ocr.ts, 서버 전용)이 돌려준 값을 다듬고, 서류의 어느 사업자가 거래처인지 고르고,
 * 거래처 칸으로 옮긴다. DB: partner_document(0088) + 비공개 버킷 partner-docs.
 */
import { normalizePartnerName } from "@/lib/partner";

/** 인식한 서류 종류 */
export type BizDocType = "tax_invoice" | "invoice" | "biz_registration" | "business_card" | "other";
export const BIZ_DOC_TYPES: readonly BizDocType[] = ["tax_invoice", "invoice", "biz_registration", "business_card", "other"];
export const BIZ_DOC_TYPE_LABEL: Record<BizDocType, string> = {
  tax_invoice: "세금계산서",
  invoice: "계산서",
  biz_registration: "사업자등록증",
  business_card: "명함",
  other: "기타 서류",
};

/** 저장 분류(partner_document.kind) */
export type PartnerDocKind = "biz_cert" | "tax_invoice" | "other";
export const PARTNER_DOC_KINDS: readonly PartnerDocKind[] = ["biz_cert", "tax_invoice", "other"];
export const PARTNER_DOC_KIND_LABEL: Record<PartnerDocKind, string> = {
  biz_cert: "사업자등록증",
  tax_invoice: "계산서",
  other: "이미지",
};
export const docKindOf = (t: BizDocType): PartnerDocKind =>
  t === "biz_registration" ? "biz_cert" : t === "tax_invoice" || t === "invoice" ? "tax_invoice" : "other";

/** 거래처 1곳당 사업자 이미지 상한 */
export const PARTNER_DOC_MAX = 6;
/** 이미지 업로드 한 번(서버 액션 본문 상한 4MB, next.config)에 싣는 최대 크기 — multipart 여유를 두고 3MB. */
export const PARTNER_DOC_BATCH_BYTES = 3 * 1024 * 1024;
/** 화면에 보이는 사업자 이미지 1장 — url 은 서버가 만든 짧은 서명 URL(비공개 버킷). */
export type PartnerDocView = { id: string; kind: PartnerDocKind; url: string; sort_order: number; created_at: string };

export type BizPartyRole = "supplier" | "buyer" | "holder";
export const BIZ_PARTY_ROLE_LABEL: Record<BizPartyRole, string> = { supplier: "공급자", buyer: "공급받는자", holder: "사업자" };

/** 서류에서 읽은 사업자 1곳 — business_no·phone 은 숫자만. */
export type BizParty = {
  role: BizPartyRole;
  business_no: string | null;
  name: string | null;
  representative: string | null;
  address: string | null;
  business_type: string | null; // 업태
  business_item: string | null; // 종목
  email: string | null;
  phone: string | null;
};
export type BizDocReading = { docType: BizDocType; parties: BizParty[]; note: string | null };

const onlyDigits = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\D/g, "") : "");

/** 업태·종목 칸 상한 — 팝빌 세금계산서 업태(invoiceeBizType)·종목(invoiceeBizClass) 최대 100자. */
export const BIZ_TYPE_ITEM_MAX = 100;

/**
 * 업태·종목 목록 다듬기 — 쉼표로 나눠 앞뒤 공백·빈 항목을 버리고 같은 항목은 처음 것만 남긴다(사업자등록증은 종목마다
 * 업태를 되풀이한다). 상한을 넘으면 넘는 항목부터 뺀다(항목 중간에서 자르지 않음 — 첫 항목이 넘을 때만 자른다).
 */
export function bizListText(v: string | null | undefined, max = BIZ_TYPE_ITEM_MAX): string | null {
  const items: string[] = [];
  for (const raw of (v ?? "").split(",")) {
    const s = raw.replace(/\s+/g, " ").trim();
    if (s && !items.includes(s)) items.push(s);
  }
  if (items.length === 0) return null;
  let out = items[0].slice(0, max);
  for (const s of items.slice(1)) {
    if (out.length + 2 + s.length > max) break;
    out += `, ${s}`;
  }
  return out;
}

/** 사업자등록번호 검증번호 확인(국세청 규칙: 가중치 1,3,7,1,3,7,1,3,5). 0000000000 같은 빈 번호는 거짓. */
export function isValidBizNo(no: string | null | undefined): boolean {
  const d = onlyDigits(no ?? "");
  if (d.length !== 10 || /^0+$/.test(d)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(d[9]);
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || /^(null|none|n\/a|없음|-+)$/i.test(s)) return null;
  return s.slice(0, max);
}
// 13자리(법인등록번호·주민등록번호)는 버린다 — 사업자번호 10자리만.
const bizNoOf = (v: unknown) => {
  const d = onlyDigits(v);
  return d.length === 10 ? d : null;
};
const emailOf = (v: unknown) => {
  const s = text(v, 120)?.replace(/\s/g, "");
  return s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s.toLowerCase() : null;
};
const phoneOf = (v: unknown) => {
  const d = onlyDigits(v);
  return d.length >= 8 && d.length <= 12 ? d : null;
};

/** AI 응답(JSON)을 믿지 않고 다듬는다 — 모르는 값·형식이 틀린 번호는 버리고, 사업자 정보가 없는 항목은 뺀다. */
export function sanitizeReading(raw: unknown): BizDocReading {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const docType = BIZ_DOC_TYPES.includes(r.doc_type as BizDocType) ? (r.doc_type as BizDocType) : "other";
  const single = docType === "biz_registration" || docType === "business_card" || docType === "other";
  const seen = new Set<BizPartyRole>();
  const parties: BizParty[] = [];
  for (const item of Array.isArray(r.parties) ? r.parties : []) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    let role: BizPartyRole = p.role === "supplier" || p.role === "buyer" ? p.role : "holder";
    if (single) role = "holder";
    const party: BizParty = {
      role,
      business_no: bizNoOf(p.business_no),
      name: text(p.name, 100),
      representative: text(p.representative, 60),
      address: text(p.address, 200),
      business_type: bizListText(text(p.business_type, 1000)),
      business_item: bizListText(text(p.business_item, 1000)),
      email: emailOf(p.email),
      phone: phoneOf(p.phone),
    };
    if (!party.name && !party.business_no) continue;
    if (seen.has(role)) continue; // 같은 칸을 두 번 읽은 것 — 처음 것만
    seen.add(role);
    parties.push(party);
    if (single) break;
  }
  return { docType, parties, note: text(r.note, 300) };
}

/** 우리 회사(책별 company_profile) — 서류에서 거래처 쪽을 고를 때 뺀다. */
export type OwnCompany = { business_no: string | null; name: string | null };

export type PartyPick =
  | { kind: "picked"; party: BizParty } // 거래처로 쓸 사업자 하나
  | { kind: "choose"; parties: BizParty[] } // 둘 다 우리 회사가 아님 — 사람이 고른다
  | { kind: "own_only" } // 보이는 사업자가 모두 우리 회사
  | { kind: "none" }; // 사업자 정보를 못 읽음

/** 서류의 사업자 중 거래처 쪽을 고른다 — 우리 회사(사업자번호, 번호를 못 읽었으면 상호)를 빼고 남는 쪽. */
export function pickCounterparty(reading: BizDocReading, own: OwnCompany[]): PartyPick {
  if (reading.parties.length === 0) return { kind: "none" };
  const ownNos = new Set(own.map((o) => onlyDigits(o.business_no ?? "")).filter((d) => d.length === 10));
  const ownNames = new Set(own.map((o) => normalizePartnerName(o.name)).filter(Boolean));
  const isOwn = (p: BizParty) =>
    p.business_no ? ownNos.has(p.business_no) : !!p.name && ownNames.has(normalizePartnerName(p.name));
  const others = reading.parties.filter((p) => !isOwn(p));
  if (others.length === 0) return { kind: "own_only" };
  if (others.length === 1) return { kind: "picked", party: others[0] };
  return { kind: "choose", parties: others };
}

/** 거래처 칸(partner 컬럼)으로 옮길 값 */
export type PartnerDocFields = {
  name: string | null;
  business_no: string | null;
  representative: string | null;
  address: string | null;
  business_type: string | null; // 업태
  business_item: string | null; // 종목
  email: string | null;
  phone: string | null;
};
export type PartnerDocField = keyof PartnerDocFields;
export const PARTNER_DOC_FIELD_LABEL: Record<PartnerDocField, string> = {
  name: "거래처명",
  business_no: "사업자번호",
  representative: "대표자",
  address: "주소",
  business_type: "업태",
  business_item: "종목",
  email: "이메일",
  phone: "연락처",
};

export const partnerFieldsOf = (p: BizParty): PartnerDocFields => ({
  name: p.name,
  business_no: p.business_no,
  representative: p.representative,
  address: p.address,
  business_type: p.business_type,
  business_item: p.business_item,
  email: p.email,
  phone: p.phone,
});

/** 묻지 않고 바로 등록해도 되는가 — 상호가 있고 사업자번호 검증번호가 맞을 때만(아니면 폼에 채워 사람이 확인). */
export const canAutoRegister = (f: Pick<PartnerDocFields, "name" | "business_no">) => !!f.name && isValidBizNo(f.business_no);

/** 기존 거래처에 채울 칸 — 이름은 바꾸지 않는다(매출·매입의 표준명). */
export const DOC_FILL_FIELDS = ["business_no", "representative", "address", "business_type", "business_item", "email", "phone"] as const;

/**
 * 빈 칸만 채운다(이미 적힌 값은 그대로). 사업자번호·연락처는 숫자만 비교해 빈 칸인지 본다.
 * patch = 바꿀 칸만, filled = 채운 칸 이름.
 */
export function fillEmpty(
  current: Partial<Record<PartnerDocField, string | null | undefined>>,
  fields: PartnerDocFields,
): { patch: Partial<PartnerDocFields>; filled: PartnerDocField[] } {
  const patch: Partial<PartnerDocFields> = {};
  const filled: PartnerDocField[] = [];
  for (const k of DOC_FILL_FIELDS) {
    const now = current[k];
    const empty = k === "business_no" || k === "phone" ? onlyDigits(now ?? "") === "" : !now?.trim();
    if (empty && fields[k]) {
      patch[k] = fields[k];
      filled.push(k);
    }
  }
  return { patch, filled };
}

/** 이 거래처의 사업자번호와 이미지의 번호가 다른가(둘 다 있을 때만) — 다른 거래처 서류를 올린 경우를 막는다. */
export const bizNoConflicts = (current: string | null | undefined, fromDoc: string | null | undefined) => {
  const a = onlyDigits(current ?? "");
  const b = onlyDigits(fromDoc ?? "");
  return a !== "" && b !== "" && a !== b;
};
