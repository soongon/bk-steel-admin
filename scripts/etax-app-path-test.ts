/**
 * 앱 실데이터 발행 경로 검증 — 서버액션(issueSaleTaxInvoice)이 쓰는 코드(buildSaleEtaxInput·
 * SALE_ETAX_SELECT·getEtaxProvider·record_sale_tax_invoice RPC)를 그대로 태운다.
 *   npx tsx scripts/etax-app-path-test.ts
 *
 * 테스트 거래처+SL 전자세금계산서 매출 1건 생성 → 발행 → 상태조회 → PDF → sale 동기화 확인
 * → 끝나면 테스트베드 발행취소 + 로컬 행 전부 hard delete(흔적 제거). IsTest 강제 true.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
process.env.POPBILL_IS_TEST = "true"; // ⚠️ 운영 사고 방지 — 무조건 테스트베드

import { createClient } from "@supabase/supabase-js";
import { computeVat } from "@/lib/transaction";
import { fetchCompanyProfile } from "@/lib/company-profile";
import { calculateRebarWeight } from "@/lib/rebar";
import { SALE_ETAX_SELECT, buildSaleEtaxInput } from "@/lib/etax/sale-payload";
import { getEtaxProvider } from "@/lib/etax";
import { digitsOnly } from "@/lib/format";

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

/** 유효 사업자등록번호(체크섬) 생성 — 테스트 거래처용. */
function validBizNo(first9: string): string {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(first9[i]) * w[i];
  sum += Math.floor((parseInt(first9[8]) * 5) / 10);
  return first9 + ((10 - (sum % 10)) % 10);
}

const REBAR_ITEM_ID = "5ae523a6-f9ba-477c-ab0b-8c40d62ad053"; // 철근 D13 SD400 8M
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

async function main() {
  if (!process.env.POPBILL_LINK_ID) throw new Error("POPBILL_LINK_ID 없음");
  const stamp = Date.now();
  const docNo = `ETAXT${stamp}`; // mgtKey = sl-ETAXT… (≤24자)
  let partnerId: string | null = null;
  let saleId: string | null = null;
  const corpNum = "5142154714"; // SL(공급자)

  try {
    // 1) 테스트 거래처(유효 사업자번호)
    const buyerBizNo = validBizNo("123456789");
    console.log("1) 테스트 거래처 생성 — 사업자번호", buyerBizNo);
    const { data: p, error: pe } = await s
      .from("partner")
      .insert({
        code: `ETAXTEST${stamp}`,
        name: "테스트철근상사(발행검증)",
        business_no: buyerBizNo,
        representative: "김검증",
        industry: "건설",
        address: "경상북도 포항시 남구",
        email: "etax-test@example.com",
        phone: "0541112222",
        is_active: true,
      })
      .select("id")
      .single();
    if (pe) throw new Error("거래처 생성 실패: " + pe.message);
    partnerId = p.id;

    // 2) SL 전자세금계산서 매출 — D13 5톤(이론중량) @940/kg, create_sale_with_lines(앱 RPC)
    const item = { length_m: 8, bars_per_tonne: 120 };
    const spec = { unit_weight_kg_per_m: 0.995, standard_length_m: 8 };
    const calc = calculateRebarWeight(item, spec, "ton", 5, 940, false, true)!;
    const subtotal = calc.subtotal;
    const { vatType, vatRate, vat, total } = computeVat(true, "tax_invoice_electronic", subtotal);
    console.log(`2) 매출 생성 — ${docNo} · 공급가 ${subtotal.toLocaleString()} · 세액 ${vat.toLocaleString()} · 합계 ${total.toLocaleString()}`);
    const { error: se } = await s.rpc("create_sale_with_lines", {
      p_sale: {
        book: "sl",
        doc_no: docNo,
        partner_id: partnerId,
        site_id: null,
        site_name: null,
        ordered_on: today,
        delivered_on: today,
        is_documented: true,
        tax_doc_type: "tax_invoice_electronic",
        vat_type: vatType,
        vat_rate: vatRate,
        subtotal_krw: subtotal,
        vat_krw: vat,
        total_krw: total,
        payment_due_on: null,
        settled_on: null,
        status: "confirmed",
        notes: "[발행 경로 검증용 — 자동 삭제 예정]",
      },
      p_lines: [
        {
          item_id: REBAR_ITEM_ID,
          unit: "ton",
          qty: 5,
          unit_price_krw: 940,
          weight_kg: calc.weightKg,
          line_subtotal_krw: calc.subtotal,
        },
      ],
    });
    if (se) throw new Error("매출 생성 실패: " + se.message);
    const { data: srow } = await s.from("sale").select("id").eq("doc_no", docNo).eq("book", "sl").maybeSingle();
    saleId = srow!.id;

    // 3) loadSale (앱과 동일 select) → 4) 공급자 프로필 → 5) payload(앱 빌더)
    const { data: sale } = await s.from("sale").select(SALE_ETAX_SELECT).eq("id", saleId).maybeSingle();
    const company = await fetchCompanyProfile(s as any, "sl");
    if (!company) throw new Error("SL company_profile 없음");
    const partner = (sale as any).partner;
    const input = buildSaleEtaxInput(sale as any, company, {
      writeDateIso: today,
      purpose: "charge",
      remark: "발행 경로 검증",
      buyerBizNo: digitsOnly(partner?.business_no ?? ""),
      buyerEmail: partner?.email ?? null,
      buyerCeo: partner?.representative ?? null,
    });
    console.log("5) payload mgtKey:", input.mgtKey, "| 공급자", input.supplier.corpNum, "→ 공급받는자", input.buyer.corpNum);
    console.log("   라인:", input.lines.map((l) => `${l.itemName}/${l.spec} ${l.qty}t ${l.supplyCost.toLocaleString()}+${l.tax.toLocaleString()}`).join(", "));

    // 6) 발행(어댑터) → 7) record_sale_tax_invoice RPC
    const provider = getEtaxProvider();
    console.log("6) provider.issue …", `(provider=${provider.name}, IsTest=true)`);
    const result = await provider.issue(input);
    console.log("   →", JSON.stringify(result));
    const { error: re } = await s.rpc("record_sale_tax_invoice", {
      p_sale_id: saleId,
      p_invoice: {
        provider: provider.name,
        mgt_key: result.mgtKey,
        nts_confirm_num: result.ntsConfirmNum,
        state: result.state,
        purpose: input.purpose,
        write_date: today,
        supplier: input.supplier,
        buyer: input.buyer,
        lines: input.lines,
        supply_krw: input.supplyCostTotal,
        vat_krw: input.taxTotal,
        total_krw: input.totalAmount,
        item_summary: input.itemSummary,
        remark: input.remark,
        asp_response: result.raw,
      },
    });
    if (re) throw new Error("record_sale_tax_invoice 실패: " + re.message);

    // 8) 상태조회 → update_tax_invoice_state RPC
    console.log("8) getStatus …");
    const status = await provider.getStatus(corpNum, result.mgtKey);
    console.log("   →", JSON.stringify({ state: status.state, ntsConfirmNum: status.ntsConfirmNum }));
    await s.rpc("update_tax_invoice_state", {
      p_sale_id: saleId,
      p_state: status.state,
      p_nts: status.ntsConfirmNum ?? "",
    });

    // 9) PDF URL
    const url = await provider.getPrintUrl(corpNum, result.mgtKey);
    console.log("9) PDF URL:", url.slice(0, 60) + "…");

    // 10) DB 동기화 확인 (sale + tax_invoice)
    const { data: after } = await s
      .from("sale")
      .select("tax_invoice_issued_on, tax_doc_no, tax_doc_type")
      .eq("id", saleId)
      .maybeSingle();
    const { data: ti } = await s
      .from("tax_invoice")
      .select("state, nts_confirm_num, mgt_key, supply_krw, vat_krw, total_krw, item_summary")
      .eq("sale_id", saleId)
      .maybeSingle();
    console.log("\n=== 10) DB 동기화 결과 ===");
    console.log("sale.tax_invoice_issued_on:", after?.tax_invoice_issued_on, "| tax_doc_no:", after?.tax_doc_no);
    console.log("tax_invoice:", JSON.stringify(ti));

    const ok =
      after?.tax_invoice_issued_on === today &&
      !!after?.tax_doc_no &&
      ti?.state === "nts_approved" &&
      Number(ti?.total_krw) === total;
    console.log(ok ? "\n✅ 앱 발행 경로 end-to-end 정상 (발행→상태→PDF→sale 동기화)" : "\n⚠️ 동기화 일부 불일치 — 위 값 확인 필요");
  } finally {
    // 정리: 테스트베드 발행취소 + 로컬 행 hard delete
    console.log("\n=== 정리 ===");
    if (saleId) {
      try {
        const { data: ti } = await s.from("tax_invoice").select("mgt_key, provider").eq("sale_id", saleId).maybeSingle();
        if (ti?.mgt_key && ti.provider !== "manual") {
          await getEtaxProvider().cancel(corpNum, ti.mgt_key, "검증 후 자동 취소");
          console.log("테스트베드 발행취소:", ti.mgt_key);
        }
      } catch (e) {
        console.log("발행취소 스킵(무해):", e instanceof Error ? e.message : e);
      }
      await s.from("tax_invoice").delete().eq("sale_id", saleId);
      await s.from("sale_line").delete().eq("sale_id", saleId);
      await s.from("sale").delete().eq("id", saleId);
      console.log("매출/라인/세금계산서 행 삭제:", saleId);
    }
    if (partnerId) {
      await s.from("partner").delete().eq("id", partnerId);
      console.log("테스트 거래처 삭제:", partnerId);
    }
  }
}

main().catch((e) => {
  console.error("실패:", e?.message ?? e);
  process.exit(1);
});
