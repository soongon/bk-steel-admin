// 세금계산서·자료 종류 옵션 — 매출/매입 폼 공용(client-safe 상수).

export const TAX_DOC_OPTIONS = [
  { value: "tax_invoice_electronic", label: "전자세금계산서" },
  { value: "tax_invoice_paper", label: "종이세금계산서" },
  { value: "invoice", label: "계산서 (면세)" },
  { value: "cash_receipt", label: "현금영수증" },
  { value: "simple_receipt", label: "간이영수증" },
  { value: "none", label: "무자료" },
] as const;
