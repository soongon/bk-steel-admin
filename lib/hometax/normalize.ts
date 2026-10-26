/**
 * 팝빌 홈택스 연계 응답 → hometax_invoice 행 정규화 (순수 함수 — tests/hometax-normalize.test.ts).
 * 필드명은 팝빌 공식 문서(HTTaxinvoice 목록 요약 HTTaxinvoiceAbbr · 상세 HTTaxinvoice) 기준.
 * 응답 형식이 조금 달라도 깨지지 않게 전부 optional 로 읽고, 원본은 raw 에 통째로 남긴다.
 */
import type { Book } from "@/lib/book";
import type { HometaxDirection, HometaxInvoiceInsert, HometaxItem, HometaxKind, HometaxParty } from "./types";

type Rec = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const digits = (v: unknown): string => (v == null ? "" : String(v).replace(/\D/g, ""));

/** 'YYYYMMDD' | 'YYYY-MM-DD' | 'YYYYMMDDHHmmss' → 'YYYY-MM-DD'. 못 읽으면 null. */
export function toIsoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  if (d.length < 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** 'YYYY-MM-DD' → 팝빌 입력 'YYYYMMDD'. */
export const toPopbillDate = (iso: string): string => iso.replace(/-/g, "");

function party(r: Rec, prefix: "invoicer" | "invoicee" | "trustee"): HometaxParty {
  return {
    biz_no: digits(r[`${prefix}CorpNum`]),
    name: str(r[`${prefix}CorpName`]),
    ceo: str(r[`${prefix}CEOName`]),
    email: str(r[`${prefix}Email`] ?? r[`${prefix}Email1`]),
    addr: str(r[`${prefix}Addr`]),
    tax_reg_id: str(r[`${prefix}TaxRegID`]),
    ...(prefix === "invoicee" ? { type: str(r.invoiceeType) } : {}),
  };
}

export function normalizeItems(detail: Rec | null | undefined): HometaxItem[] | null {
  const list = detail?.detailList;
  if (!Array.isArray(list)) return null;
  return list.map((it) => {
    const r = (it ?? {}) as Rec;
    return {
      serial: num(r.serialNum),
      date: toIsoDate(r.purchaseDT),
      name: str(r.itemName),
      spec: str(r.spec),
      qty: num(r.qty),
      unit_cost: num(r.unitCost),
      supply: num(r.supplyCost),
      tax: num(r.tax),
      remark: str(r.remark),
    };
  });
}

/** 면세(계산서) 판정 — taxType '면세' 또는 invoiceType 에 '계산서'만 있고 '세금'이 없을 때. */
export function kindOf(taxType: string | null, invoiceType: string | null): HometaxKind {
  if (taxType === "면세") return "invoice";
  if (invoiceType && invoiceType.includes("계산서") && !invoiceType.includes("세금")) return "invoice";
  return "tax_invoice";
}

/**
 * 목록 요약(abbr) + (있으면) 상세(detail) → 저장 행. 상세가 있으면 상세 값을 우선한다.
 * 수정세금계산서: 상세 modifyCode(1~6) 또는 요약 modifyYN('Y'|true) → orig 승인번호를 가리킨다.
 */
export function normalizeInvoice(
  book: Book,
  direction: HometaxDirection,
  abbr: Rec,
  detail?: Rec | null,
  nowIso: string = new Date().toISOString(),
): HometaxInvoiceInsert | null {
  const src: Rec = { ...abbr, ...(detail ?? {}) };
  const nts = digits(src.ntsconfirmNum ?? src.ntsConfirmNum).length === 24
    ? digits(src.ntsconfirmNum ?? src.ntsConfirmNum)
    : str(src.ntsconfirmNum ?? src.ntsConfirmNum);
  const writeDate = toIsoDate(src.writeDate);
  if (!nts || nts.length !== 24 || !writeDate) return null;

  const taxType = str(src.taxType);
  const invoiceType = str(src.invoiceType);
  const modifyCodeRaw = num(src.modifyCode);
  const modifyYN = src.modifyYN === true || String(src.modifyYN ?? "").toUpperCase() === "Y";
  const modify_code = modifyCodeRaw && modifyCodeRaw > 0 ? modifyCodeRaw : modifyYN ? -1 : null; // -1 = 수정분인데 사유 미상(상세 전)
  const orig = str(src.orgNTSConfirmNum ?? src.orgNtsConfirmNum ?? src.originalNTSConfirmNum);

  const supply = num(src.supplyCostTotal) ?? 0;
  const tax = num(src.taxTotal) ?? 0;
  const total = num(src.totalAmount) ?? supply + tax;
  const items = normalizeItems(detail);

  return {
    book,
    direction,
    nts_confirm_num: nts,
    kind: kindOf(taxType, invoiceType),
    tax_type: taxType,
    issue_type: str(src.issueType),
    purpose: str(src.purposeType),
    modify_code,
    orig_nts_confirm_num: orig && orig !== nts ? digits(orig) || orig : null,
    write_date: writeDate,
    issue_date: toIsoDate(src.issueDate),
    send_date: toIsoDate(src.sendDate),
    supplier: party(src, "invoicer"),
    invoicee: party(src, "invoicee"),
    trustee: digits(src.trusteeCorpNum) ? party(src, "trustee") : null,
    supply_amount: Math.round(supply),
    tax_amount: Math.round(tax),
    total_amount: Math.round(total),
    item_summary: str(src.itemName) ?? items?.[0]?.name ?? null,
    items,
    detail_fetched_at: detail ? nowIso : null,
    raw: { abbr, ...(detail ? { detail } : {}) },
    source: "popbill",
  };
}

/** 수집 기본 기간 — 전송일 기준 최근 n일(KST). 홈택스 전송은 발행 익일이라 작성일 기준이면 빠진다. */
export function recentRange(days: number, todayKst: string): { from: string; to: string } {
  const to = new Date(`${todayKst}T00:00:00Z`);
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: todayKst };
}

/** 팝빌 권한·인증 오류를 사람이 읽는 문장으로. */
export function friendlyHometaxError(message: string): string {
  if (/이용 권한이 부여되지/.test(message)) {
    return "팝빌 홈택스 연계 API 상품 이용 권한이 없습니다. 팝빌 파트너 콘솔에서 '홈택스 연계(세금계산서)' API 상품을 켜 주세요.";
  }
  if (/정액제|과금/.test(message)) return `팝빌 정액제 상태를 확인해 주세요: ${message}`;
  if (/인증서|부서사용자|공동인증/.test(message)) return `홈택스 인증 문제: ${message} — 팝빌에 부서사용자 등록이 되어 있는지 확인해 주세요.`;
  return message;
}
