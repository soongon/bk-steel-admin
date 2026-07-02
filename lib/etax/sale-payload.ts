// 매출 → 전자세금계산서 payload 빌더(순수 함수). 서버액션(tax-invoice-actions)과
// 검증 스크립트(scripts/etax-app-path-test)가 같은 코드를 쓰도록 분리 — 실데이터 매핑을
// 한 곳에서만 정의한다. createClient·RPC·revalidate 같은 부수효과는 호출자(액션)가 담당.
import { digitsOnly } from "@/lib/format";
import { type CompanyProfile } from "@/lib/company-profile";
import { type EtaxIssueInput, type EtaxLine } from "./types";

/** loadSale select — 발행 payload 구성에 필요한 매출+거래처+라인. 액션·스크립트 공용. */
export const SALE_ETAX_SELECT = `id, book, doc_no, ordered_on, is_documented, tax_doc_type, vat_type, vat_rate,
       subtotal_krw, vat_krw, total_krw,
       partner:partner(id, name, business_no, representative, address, industry, email, phone),
       sale_line(id, qty, unit, unit_price_krw, line_subtotal_krw, display_name,
         item:item(name, category, rebar_spec_code, rebar_grade_code, length_m))`;

/** sale_line → 세금계산서 품목 라인(철근은 '철근' 라벨·display_name 반영, 라인별 세액 산출). */
export function buildSaleEtaxLines(sale: Record<string, any>): EtaxLine[] {
  const vatRate = Number(sale.vat_rate ?? 10);
  const dt = digitsOnly(String(sale.ordered_on));
  return (sale.sale_line ?? []).map((l: any, i: number): EtaxLine => {
    const it = l.item;
    const isReb = it?.category === "rebar" && !!it?.rebar_spec_code;
    const supply = Math.round(Number(l.line_subtotal_krw ?? Number(l.qty) * Number(l.unit_price_krw)));
    const tax = sale.is_documented ? Math.round((supply * vatRate) / 100) : 0;
    const spec = isReb
      ? [it.rebar_spec_code, it.rebar_grade_code, it.length_m ? `${it.length_m}M` : null]
          .filter(Boolean)
          .join(" ")
      : "";
    return {
      serialNum: i + 1,
      date: dt,
      itemName: (l.display_name ?? (isReb ? "철근" : it?.name)) || "품목",
      spec: spec || null,
      qty: Number(l.qty),
      unitCost: Number(l.unit_price_krw) || null, // 금액 직접입력(단가 0) → 계산서 단가 공란
      supplyCost: supply,
      tax,
      remark: null,
    };
  });
}

function taxTypeOf(vatType: string): "taxable" | "zero" | "free" {
  if (vatType === "zero_rated") return "zero";
  if (vatType === "exempt" || vatType === "non_taxable") return "free";
  return "taxable";
}

/** 품목 요약('철근 외 2건'). 라인 없으면 null. */
export function summarizeEtaxLines(lines: EtaxLine[]): string | null {
  if (lines.length === 0) return null;
  return lines.length > 1 ? `${lines[0].itemName} 외 ${lines.length - 1}건` : lines[0].itemName;
}

/**
 * 매출+공급자(회사)+거래처(보강값)로 전자세금계산서 발행 payload 구성.
 * buyer 의 사업자번호·이메일·대표자는 호출자가 보강(opts override 우선)한 값으로 넘긴다.
 * mgtKey = `{book}-{doc_no}`(멱등). 부수효과 없음.
 */
export function buildSaleEtaxInput(
  sale: Record<string, any>,
  company: CompanyProfile,
  opts: {
    writeDateIso: string;
    purpose: "charge" | "receipt";
    remark: string | null;
    buyerBizNo: string;
    buyerEmail: string | null;
    buyerCeo: string | null;
  },
): EtaxIssueInput {
  const partner = sale.partner as Record<string, any> | null;
  const lines = buildSaleEtaxLines(sale);
  return {
    mgtKey: `${sale.book}-${sale.doc_no}`,
    writeDate: digitsOnly(opts.writeDateIso),
    purpose: opts.purpose,
    taxType: taxTypeOf(String(sale.vat_type)),
    supplier: {
      corpNum: digitsOnly(company.business_no),
      name: company.name,
      ceoName: company.representative,
      addr: company.address,
      bizType: company.business_type,
      bizClass: company.business_item,
      contactName: company.representative,
      email: company.email,
      tel: company.phone ?? company.mobile,
    },
    buyer: {
      corpNum: opts.buyerBizNo,
      name: partner?.name ?? "",
      ceoName: opts.buyerCeo,
      addr: partner?.address ?? null,
      bizType: partner?.industry ?? null,
      bizClass: null,
      contactName: partner?.name ?? null,
      email: opts.buyerEmail,
      tel: partner?.phone ?? null,
    },
    supplyCostTotal: Number(sale.subtotal_krw),
    taxTotal: Number(sale.vat_krw),
    totalAmount: Number(sale.total_krw),
    itemSummary: summarizeEtaxLines(lines),
    remark: opts.remark,
    lines,
  };
}
