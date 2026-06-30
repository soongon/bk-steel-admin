/**
 * 팝빌 테스트베드 전자세금계산서 발행 검증.
 *   npx tsx scripts/etax-testbed.ts <발행사업자번호> [공급받는자사업자번호]
 *
 * .env.local 의 POPBILL_LINK_ID·POPBILL_SECRET_KEY 사용, IsTest 강제 true(국세청 실전송 없음).
 * issue → getStatus(raw 출력으로 실제 stateCode·ntsconfirmNum 필드 확인) → getPrintUrl 순서로
 * 어댑터(lib/etax/popbill.ts)가 팝빌 응답과 맞는지 검증한다. 실패 메시지는 그대로 출력.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
process.env.POPBILL_IS_TEST = "true"; // 테스트베드 강제

async function main() {
  const supplierCorp = (process.argv[2] || "").replace(/\D/g, "");
  const buyerCorp = (process.argv[3] || supplierCorp).replace(/\D/g, "");
  if (!supplierCorp) {
    console.error("사용법: npx tsx scripts/etax-testbed.ts <발행사업자번호> [공급받는자사업자번호]");
    process.exit(1);
  }
  if (!process.env.POPBILL_LINK_ID || !process.env.POPBILL_SECRET_KEY) {
    console.error("POPBILL_LINK_ID / POPBILL_SECRET_KEY 가 .env.local 에 없습니다.");
    process.exit(1);
  }

  const { popbillProvider } = await import("../lib/etax/popbill");

  const mgtKey = "TEST" + Date.now();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const input = {
    mgtKey,
    writeDate: today,
    purpose: "charge" as const,
    taxType: "taxable" as const,
    supplier: {
      corpNum: supplierCorp,
      name: "테스트공급자",
      ceoName: "홍길동",
      addr: "경상북도 경주시",
      bizType: "도소매",
      bizClass: "철강재",
      contactName: "담당자",
      email: "test@example.com",
      tel: "0541234567",
    },
    buyer: {
      corpNum: buyerCorp,
      name: "테스트거래처",
      ceoName: "김철수",
      addr: "경상북도 포항시",
      bizType: "건설",
      bizClass: "철근콘크리트공사",
      contactName: "구매담당",
      email: "buyer@example.com",
      tel: "0549876543",
    },
    supplyCostTotal: 1_000_000,
    taxTotal: 100_000,
    totalAmount: 1_100_000,
    itemSummary: "철근",
    remark: "테스트 발행",
    lines: [
      {
        serialNum: 1,
        date: today,
        itemName: "철근",
        spec: "D10 SD400 6.0M",
        qty: 1,
        unitCost: 1_000_000,
        supplyCost: 1_000_000,
        tax: 100_000,
        remark: null,
      },
    ],
  };

  console.log("== issue ==", mgtKey, "(공급자", supplierCorp, "→ 공급받는자", buyerCorp, ")");
  const r = await popbillProvider.issue(input);
  console.log(JSON.stringify(r, null, 2));

  console.log("\n== getStatus (raw 로 stateCode·ntsconfirmNum 필드 확인) ==");
  const st = await popbillProvider.getStatus(supplierCorp, mgtKey);
  console.log(JSON.stringify(st, null, 2));

  console.log("\n== getPrintUrl ==");
  const url = await popbillProvider.getPrintUrl(supplierCorp, mgtKey);
  console.log(url);
}

main().catch((e) => {
  console.error("실패:", e?.message ?? e);
  process.exit(1);
});
