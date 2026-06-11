import { revalidatePath } from "next/cache";

/**
 * 자료성·세금계산서 종류 → 부가세 유형·세액. 매출·매입 공용.
 * 계산서=면세(exempt), 무자료/none=불과세(non_taxable) — 둘 다 부가세 신고대상 뷰에서 자동 제외.
 * 그 외 자료거래(세금계산서·현금영수증 등)는 과세 10%.
 */
export function computeVat(isDocumented: boolean, taxDocType: string, subtotal: number) {
  const vatType =
    !isDocumented || taxDocType === "none"
      ? "non_taxable"
      : taxDocType === "invoice"
        ? "exempt"
        : "standard_10";
  const vatRate = vatType === "standard_10" ? 10 : 0;
  const vat = vatRate > 0 ? Math.round((subtotal * vatRate) / 100) : 0;
  return { vatType, vatRate, vat, total: subtotal + vat };
}

/**
 * 매출/매입 변경 후 관련 화면 재검증. book 4종(all·bk·sl·b) × 화면.
 * 미수(receivables, 매출)·미지급(payables, 매입)만 종류별로 다름.
 */
export function revalidateTransactionPaths(kind: "sales" | "purchases") {
  const dueView = kind === "sales" ? "receivables" : "payables";
  for (const b of ["all", "bk", "sl", "b"]) {
    revalidatePath(`/${b}/${kind}`);
    revalidatePath(`/${b}/dashboard`);
    revalidatePath(`/${b}/${dueView}`);
    revalidatePath(`/${b}/bank`);
  }
}
