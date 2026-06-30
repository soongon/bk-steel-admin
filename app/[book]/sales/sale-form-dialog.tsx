"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileTextIcon, PlusIcon, PrinterIcon, XIcon } from "lucide-react";
import { type Book, type BookView, BOOK_LABEL, BOOKS } from "@/lib/book";
import { type CompanyProfile } from "@/lib/company-profile";
import { BookBadge } from "@/components/admin/book-badge";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { isRebarItem, sortRebar, calculateRebarWeight } from "@/lib/rebar";
import {
  type LineDraft,
  UNIT_OPTIONS,
  calcLineDraft,
  buildStatementLines,
  serializeLines,
} from "@/lib/transaction-draft";
import { fmtKrw, fmtNum } from "@/lib/format";
import { TAX_DOC_OPTIONS } from "@/lib/tax-doc";
import { createSale, updateSaleHeader } from "./actions";

export type Partner = {
  id: string;
  code: string;
  name: string;
  business_no?: string | null;
  representative?: string | null;
  address?: string | null;
  phone?: string | null;
  fax?: string | null;
  industry?: string | null;
};
export type Item = {
  id: string;
  code: string;
  name: string;
  category: string;
  rebar_spec_code: string | null;
  rebar_grade_code: string | null;
  length_m: number | null;
  bars_per_tonne: number | null; // 명목 1톤 표준본수 (톤 환산용, 규격×길이별)
};
export type RebarSpec = {
  spec_code: string;
  unit_weight_kg_per_m: number;
  standard_length_m: number;
};

export type SaleRow = {
  id: string;
  book: Book;
  doc_no: string;
  partner_id: string;
  site_id: string | null;
  site_name: string | null;
  ordered_on: string;
  delivered_on: string | null;
  status: string;
  is_documented: boolean;
  tax_doc_type: string;
  payment_due_on: string | null;
  notes: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  reserved: "주문 (미납품)",
  confirmed: "확정",
  delivered: "납품완료",
  settled: "수금완료",
  overdue: "연체",
  cancelled: "취소",
};
// 신규 매출에서 고를 수 있는 상태. 수금완료는 '수금' 버튼(통장 입금)으로만 처리.
// 등록은 '납품 전'만(주문/확정). 납품완료는 납품일이 오늘이어도 라이프사이클 '납품완료' 버튼으로만.
const NEW_STATUSES = ["reserved", "confirmed"];
// 편집 시 전이 — 서버 규칙과 동일. delivered→settled 는 폼이 아닌 수금 다이얼로그.
const STATUS_NEXT: Record<string, string[]> = {
  reserved: ["confirmed", "delivered"],
  confirmed: ["delivered"],
  delivered: [],
  overdue: [],
  settled: [],
  cancelled: [],
};

export type SiteOption = { id: string; name: string };

export function SaleFormDialog({
  open,
  onOpenChange,
  editing,
  view,
  partners,
  items,
  rebarSpecs,
  sites,
  companies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SaleRow | null;
  view: BookView;
  partners: Partner[];
  items: Item[];
  rebarSpecs: RebarSpec[];
  sites: SiteOption[];
  companies: CompanyProfile[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showStatement, setShowStatement] = useState(false); // 거래명세서 미리보기 모달
  const today = new Date().toISOString().slice(0, 10);

  // 책 (view='all'이면 사용자 선택, 아니면 고정)
  const [book, setBook] = useState<Book>(
    editing?.book ?? (view !== "all" ? (view as Book) : "sl"),
  );

  // 거래처 — datalist 검색 + name → id 매핑
  const partnerInitial = editing ? partners.find((p) => p.id === editing.partner_id) : null;
  const [partnerInput, setPartnerInput] = useState(partnerInitial?.name ?? "");
  const matchedPartner = partners.find((p) => p.name === partnerInput);

  // 품목
  const [itemId, setItemId] = useState("");
  const selectedItem = items.find((i) => i.id === itemId);
  const rebarSpec = selectedItem?.rebar_spec_code
    ? rebarSpecs.find((s) => s.spec_code === selectedItem.rebar_spec_code)
    : null;

  // 품목 구분(철근/철제) — 철근 주력이라 기본값. 토글 시 선택 초기화.
  const [itemKind, setItemKind] = useState<"rebar" | "steel">("rebar");
  const itemOptions = useMemo(
    () =>
      itemKind === "rebar"
        ? items.filter(isRebarItem).sort(sortRebar)
        : items.filter((i) => !isRebarItem(i)).sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [items, itemKind],
  );

  // 단위·수량·단가
  const [unit, setUnit] = useState<"ea" | "kg" | "ton">("ea");
  const [tonMetric, setTonMetric] = useState(false); // 톤: 1톤=1000kg 청구(소량·배달비)
  const [qtyStr, setQtyStr] = useState("");
  const [unitPriceStr, setUnitPriceStr] = useState("");
  const qty = Number(qtyStr) || 0;
  const unitPrice = Number(unitPriceStr) || 0;
  // 금액 직접입력(운송비 포함 등) — 단가 대신 라인 총액을 직접 입력(드문 소량 케이스)
  const [manualMode, setManualMode] = useState(false);
  const [manualAmountStr, setManualAmountStr] = useState("");
  const manualAmount = manualMode ? Number(manualAmountStr) || 0 : 0;

  // 누적 품목 라인 (신규 등록 — 여러 품목)
  const [lines, setLines] = useState<LineDraft[]>([]);

  // 자료성·세금
  const [isDocumented, setIsDocumented] = useState(book === "b" ? false : true);
  const [taxDocType, setTaxDocType] = useState<string>(
    book === "b" ? "none" : "tax_invoice_electronic",
  );

  // 책 변경 시 자료성 자동 동기화
  useEffect(() => {
    if (book === "b") {
      setIsDocumented(false);
      setTaxDocType("none");
    } else if (book === "bk") {
      setIsDocumented(true);
      if (taxDocType === "none" || taxDocType === "simple_receipt") {
        setTaxDocType("tax_invoice_electronic");
      }
    }
    // sl은 자유
  }, [book]); // eslint-disable-line react-hooks/exhaustive-deps

  // 현재 입력 라인 환산 미리보기 (rebar)
  const calc = useMemo(
    () => (rebarSpec ? calculateRebarWeight(selectedItem!, rebarSpec, unit, qty, unitPrice, tonMetric, true) : null),
    [rebarSpec, selectedItem, unit, qty, unitPrice, tonMetric],
  );

  // 라인 → 품목·환산·공급가 (공통 코어). 목록·명세서·합계 공용.
  const calcLine = (l: LineDraft) => calcLineDraft(items, rebarSpecs, l);

  // 현재 입력이 유효하면 임시 라인으로 포함(추가 버튼 안 눌러도 마지막 1건 반영)
  // 이론중량 톤은 정수만(표준본수 기반). 톤(1,000kg)은 소수 허용(예: 1.1·3.5톤). 가닥·kg은 기존대로.
  const fractionalTon = unit === "ton" && !tonMetric && !Number.isInteger(qty);
  const pendingLine: LineDraft | null =
    itemId && qty > 0 && !fractionalTon && (manualMode ? manualAmount > 0 : unitPrice > 0)
      ? { itemKind, itemId, unit, qty, unitPrice, tonMetric, manualAmount: manualMode ? manualAmount : null }
      : null;
  const allLines = pendingLine ? [...lines, pendingLine] : lines;

  // 세금·합계 — 모든 라인 공급가 합
  const lineSubtotal = allLines.reduce((s, l) => s + calcLine(l).subtotal, 0);
  const vatRate =
    isDocumented && taxDocType !== "invoice" && taxDocType !== "none" ? 10 : 0;
  const vat = Math.round((lineSubtotal * vatRate) / 100);
  const total = lineSubtotal + vat;

  // 상태·날짜
  const [orderedOn, setOrderedOn] = useState(today);
  const [deliveredOn, setDeliveredOn] = useState("");
  const [paymentDueOn, setPaymentDueOn] = useState("");
  const [status, setStatus] = useState<string>(editing?.status ?? "reserved");
  const [siteName, setSiteName] = useState(editing?.site_name ?? "");
  const matchedSite = sites.find((s) => s.name === siteName);
  const [notes, setNotes] = useState(editing?.notes ?? "");

  // 상태 옵션 — 신규는 납품 전(주문/확정)만, 편집은 현재+다음 단계만(납품완료·수금완료는 버튼/다이얼로그).
  const statusOptions = useMemo(() => {
    const values = editing
      ? Array.from(new Set<string>([editing.status, ...(STATUS_NEXT[editing.status] ?? [])]))
      : NEW_STATUSES;
    return values.map((v) => ({ value: v, label: STATUS_LABEL[v] ?? v }));
  }, [editing]);
  const statusLocked = editing != null && statusOptions.length <= 1;

  useEffect(() => {
    if (open) {
      setError(null);
      if (editing) {
        setBook(editing.book);
        setSiteName(editing.site_name ?? "");
        setOrderedOn(editing.ordered_on);
        setDeliveredOn(editing.delivered_on ?? "");
        setPaymentDueOn(editing.payment_due_on ?? "");
        setStatus(editing.status);
        setIsDocumented(editing.is_documented);
        setTaxDocType(editing.tax_doc_type);
        setNotes(editing.notes ?? "");
      } else {
        // 신규
        setBook(view !== "all" ? (view as Book) : "sl");
        setPartnerInput("");
        setSiteName("");
        setItemId("");
        setItemKind("rebar");
        setUnit("ea");
        setTonMetric(false);
        setQtyStr("");
        setUnitPriceStr("");
        setLines([]);
        setOrderedOn(today);
        setDeliveredOn("");
        setPaymentDueOn("");
        setStatus("reserved");
        setNotes("");
      }
    }
  }, [open, editing, view, today]);

  // 거래명세표 공급자(우리) — B 책은 SL 정보로 발행.
  const company = companies.find((c) => c.book === (book === "b" ? "sl" : book)) ?? null;
  const statementData: StatementData | null = (() => {
    // 거래처가 미등록(자동 생성 예정)이어도 이름만 있으면 미리보기 가능.
    const partnerNameForView = matchedPartner?.name ?? partnerInput.trim();
    if (!partnerNameForView || allLines.length === 0) return null;
    const stLines = buildStatementLines(items, rebarSpecs, allLines, vatRate);
    const lineVatSum = stLines.reduce((s, ln) => s + ln.vat_krw, 0);
    return {
      doc_no: "(미발급)",
      ordered_on: orderedOn,
      tax_doc_no: null,
      partner: {
        name: partnerNameForView,
        business_no: matchedPartner?.business_no ?? null,
        representative: matchedPartner?.representative ?? null,
        address: matchedPartner?.address ?? null,
        phone: matchedPartner?.phone ?? null,
        fax: matchedPartner?.fax ?? null,
        industry: matchedPartner?.industry ?? null,
      },
      site_name: siteName || null,
      is_documented: isDocumented,
      lines: stLines,
      subtotal_krw: lineSubtotal,
      vat_krw: lineVatSum,
      total_krw: lineSubtotal + lineVatSum,
      notes: notes || null,
    };
  })();

  function addLine() {
    if (!itemId) { setError("품목을 선택해주세요."); return; }
    if (qty <= 0) { setError("수량을 입력해주세요."); return; }
    if (fractionalTon) {
      setError("이론중량 톤은 정수만 입력하세요. 소수 톤은 단위를 '톤 (1,000kg)'로 바꿔주세요.");
      return;
    }
    if (manualMode ? manualAmount <= 0 : unitPrice <= 0) {
      setError(manualMode ? "금액을 입력해주세요." : "단가를 입력해주세요.");
      return;
    }
    setLines((prev) => [
      ...prev,
      { itemKind, itemId, unit, qty, unitPrice, tonMetric, manualAmount: manualMode ? manualAmount : null },
    ]);
    setItemId("");
    setQtyStr("");
    setUnitPriceStr("");
    setManualMode(false);
    setManualAmountStr("");
    setError(null);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("book", book);
    fd.set("ordered_on", orderedOn);
    fd.set("delivered_on", deliveredOn);
    fd.set("payment_due_on", paymentDueOn);
    fd.set("status", status);
    fd.set("is_documented", String(isDocumented));
    fd.set("tax_doc_type", taxDocType);
    fd.set("site_name", siteName);
    if (matchedSite) fd.set("site_id", matchedSite.id);
    fd.set("notes", notes);
    if (!editing) {
      // 거래처: 마스터 매칭되면 id, 아니면 이름만 — 서버(resolvePartnerId)가 없으면 자동 생성.
      if (matchedPartner) fd.set("partner_id", matchedPartner.id);
      fd.set("partner_name", partnerInput.trim());
      // 모든 라인(추가분 + 현재 입력) — 철근은 환산 중량 동봉.
      fd.set("lines", serializeLines(items, rebarSpecs, allLines));
    }
    return fd;
  }

  function doSave() {
    const fd = buildFormData();
    startTransition(async () => {
      const result = editing
        ? await updateSaleHeader(editing.id, fd)
        : await createSale(fd);
      if (result.ok) {
        toast.success(editing ? "매출이 수정되었습니다" : "매출이 등록되었습니다");
        setShowStatement(false);
        onOpenChange(false);
      } else {
        setShowStatement(false);
        setError(result.error);
      }
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!editing) {
      if (!partnerInput.trim()) {
        setError("거래처를 입력해주세요.");
        return;
      }
      if (allLines.length === 0) {
        setError("품목을 1개 이상 추가해주세요.");
        return;
      }
      setShowStatement(true); // 신규 → 거래명세서 미리보기(확인 시 등록)
      return;
    }
    doSave(); // 편집 → 헤더만 바로 저장
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl print:hidden">
        <DialogHeader>
          <DialogTitle>{editing ? "매출 수정" : "신규 매출"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* 책 + 거래처 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="책 *">
              {view === "all" && !editing ? (
                <div className="flex gap-2">
                  {BOOKS.map((b) => (
                    <button
                      type="button"
                      key={b}
                      onClick={() => setBook(b)}
                      className={`flex-1 rounded-md border px-2 py-1 text-xs ${book === b ? "bg-foreground text-background" : "bg-background"}`}
                    >
                      {BOOK_LABEL[b]}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-8 items-center px-2">
                  <BookBadge book={book} />
                </div>
              )}
            </Field>
            <Field label="거래처 *">
              <Input
                list="partners-list"
                value={partnerInput}
                onChange={(e) => setPartnerInput(e.target.value)}
                placeholder="거래처명 입력 / 선택"
                disabled={!!editing}
                required
              />
              <datalist id="partners-list">
                {partners.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
              {!editing && partnerInput && !matchedPartner ? (
                <p className="mt-0.5 text-[10px] text-amber-600">
                  미등록 거래처 — 저장 시 자동 생성됩니다
                </p>
              ) : null}
            </Field>
          </div>

          {/* 현장 + 주문일 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="현장">
              <Input
                list="sales-site-list"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="현장 검색·신규 입력"
              />
              <datalist id="sales-site-list">
                {sites.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              {siteName && !matchedSite ? (
                <p className="text-[10px] text-amber-600">
                  미등록 현장 — 저장 시 자동 생성됩니다
                </p>
              ) : null}
            </Field>
            <Field label="주문일 *">
              <Input
                type="date"
                value={orderedOn}
                onChange={(e) => setOrderedOn(e.target.value)}
                disabled={!!editing}
                required
              />
            </Field>
          </div>

          {/* 신규일 때만: 품목 + 단위 + 수량 + 단가 */}
          {!editing ? (
            <>
              <div className="grid grid-cols-[7rem_1fr] gap-3">
                <Field label="구분 *">
                  <div className="flex gap-1">
                    {(["rebar", "steel"] as const).map((k) => (
                      <button
                        type="button"
                        key={k}
                        onClick={() => {
                          setItemKind(k);
                          setItemId("");
                        }}
                        className={`flex-1 rounded-md border px-2 py-1 text-xs ${itemKind === k ? "bg-foreground text-background" : "bg-background"}`}
                      >
                        {k === "rebar" ? "철근" : "철제"}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="품목 *">
                  <select
                    value={itemId}
                    onChange={(e) => setItemId(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">— 선택 —</option>
                    {itemOptions.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                  {itemOptions.length === 0 ? (
                    <p className="text-[10px] text-amber-600">이 구분의 활성 품목이 없습니다</p>
                  ) : null}
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="단위 *">
                  <select
                    value={tonMetric ? "ton_metric" : unit}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTonMetric(v === "ton_metric");
                      setUnit(v === "ton_metric" ? "ton" : (v as "ea" | "kg" | "ton"));
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="수량 *">
                  <Input
                    type="number"
                    step={unit === "ton" && tonMetric ? "any" : "1"}
                    min="0"
                    value={qtyStr}
                    onChange={(e) => setQtyStr(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label={manualMode ? "금액(원) *" : itemKind === "rebar" ? "단가(원/kg) *" : "단가(원) *"}>
                  <Input
                    type="number"
                    step="1"
                    value={manualMode ? manualAmountStr : unitPriceStr}
                    onChange={(e) =>
                      manualMode ? setManualAmountStr(e.target.value) : setUnitPriceStr(e.target.value)
                    }
                    placeholder="0"
                  />
                </Field>
              </div>

              {/* 금액 직접입력 토글 — 운송비 포함 등 소량 케이스(단가 대신 라인 총액) */}
              <label className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={manualMode}
                  onChange={(e) => {
                    setManualMode(e.target.checked);
                    setManualAmountStr("");
                  }}
                  className="size-3.5 accent-foreground"
                />
                금액 직접입력 — 단가 대신 라인 총액(운송비 포함 등)
              </label>
              {fractionalTon ? (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  이론중량 톤은 정수만 — 소수 톤(1.1·3.5 등)은 단위를 ‘톤 (1,000kg)’로 바꿔주세요.
                </p>
              ) : null}

              {/* 환산 표시 (rebar) */}
              {calc && rebarSpec ? (
                <div className="rounded-lg border border-dashed bg-muted/30 p-2 text-xs">
                  <p className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground">
                    철근 환산
                    {calc.tonStd ? (
                      <span className="rounded bg-amber-100 px-1 text-[10px] font-normal text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                        명목 {qty}톤 → 표준 {selectedItem?.bars_per_tonne}본/톤
                      </span>
                    ) : calc.tonMetric ? (
                      <span className="rounded bg-blue-100 px-1 text-[10px] font-normal text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                        1톤=1,000kg 청구 ({qty}톤 = {fmtNum(qty * 1000)}kg)
                      </span>
                    ) : null}
                  </p>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <span>가닥: <strong>{calc.bars.toLocaleString()}</strong></span>
                    <span>실중량: <strong>{fmtNum(calc.weightKg)}kg</strong> ({fmtNum(calc.weightKg / 1000, 3)}톤)</span>
                    <span>단위중량: {rebarSpec.unit_weight_kg_per_m}kg/m × {calc.lengthM}m</span>
                  </div>
                </div>
              ) : null}

              {/* 품목 추가 버튼 + 누적 리스트 */}
              <div className="flex items-center justify-between">
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <PlusIcon className="size-4" /> 품목 추가
                </Button>
                <span className="text-xs text-muted-foreground">
                  {lines.length > 0
                    ? `추가된 품목 ${lines.length}건`
                    : "입력 후 ‘품목 추가’ (마지막 1건은 자동 포함)"}
                </span>
              </div>

              {lines.length > 0 ? (
                <div className="divide-y rounded-lg border">
                  {lines.map((l, idx) => {
                    const { item: li, calc: c, subtotal: sub } = calcLine(l);
                    const reb = !!li?.rebar_spec_code && !!c;
                    return (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span className="flex-1 truncate font-medium">{li?.name ?? "—"}</span>
                        <span className="text-muted-foreground">
                          {reb ? `${fmtNum(c!.weightKg)}kg` : `${l.qty}${l.unit}`}
                          {l.manualAmount != null && l.manualAmount > 0
                            ? " · 금액직접"
                            : ` × ${fmtKrw(l.unitPrice)}${reb ? "/kg" : ""}`}
                        </span>
                        <span className="w-24 text-right tabular-nums">{fmtKrw(sub)}</span>
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          aria-label="삭제"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">공급가</span>
                  <span className="font-medium tabular-nums">{fmtKrw(lineSubtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">부가세 ({vatRate}%)</span>
                  <span className="font-medium tabular-nums">{fmtKrw(vat)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t pt-1">
                  <span className="font-medium">합계</span>
                  <span className="font-semibold tabular-nums">{fmtKrw(total)}</span>
                </div>
              </div>
            </>
          ) : null}

          {/* 자료 종류 + 자료 여부 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="세금계산서">
              <select
                value={taxDocType}
                onChange={(e) => {
                  setTaxDocType(e.target.value);
                  setIsDocumented(e.target.value !== "none");
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                disabled={book === "b"}
              >
                {TAX_DOC_OPTIONS.filter((o) => {
                  if (book === "bk") return o.value !== "none" && o.value !== "simple_receipt";
                  if (book === "b") return o.value === "none";
                  return true;
                }).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="상태">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={statusLocked}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
              >
                {statusOptions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {editing?.status === "delivered" ? (
                <p className="text-[10px] text-muted-foreground">수금완료는 목록의 ‘수금’ 버튼으로</p>
              ) : null}
            </Field>
          </div>

          {/* 납품·수금 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="납품일">
              <Input
                type="date"
                value={deliveredOn}
                onChange={(e) => setDeliveredOn(e.target.value)}
              />
            </Field>
            <Field label="수금 예정일">
              <Input
                type="date"
                value={paymentDueOn}
                onChange={(e) => setPaymentDueOn(e.target.value)}
              />
            </Field>
          </div>

          <Field label="메모">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="선결재 / 일본산 도매 / ... 자유 메모"
              rows={2}
              className="resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </Field>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중..." : editing ? "수정" : "등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {showStatement && statementData ? (
      <Dialog open onOpenChange={(o) => { if (!o) setShowStatement(false); }}>
        <DialogContent className="!max-w-[920px] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="print:hidden">
            <DialogTitle>거래명세표 미리보기</DialogTitle>
            <DialogDescription>
              확인하면 매출이 등록됩니다. 내용이 다르면 ‘수정’으로 돌아가세요.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-zinc-100 p-3 print:bg-white print:p-0 dark:bg-zinc-900">
            <div className="mx-auto max-w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
              <TradingStatement data={statementData} company={company} recipientOnly />
            </div>
          </div>
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setShowStatement(false)}>
              수정
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <PrinterIcon className="size-4" /> 프린트
            </Button>
            <Button
              variant="secondary"
              disabled
              title="세금계산서 발급은 준비 중입니다"
            >
              <FileTextIcon className="size-4" /> 계산서 발급
            </Button>
            <Button onClick={doSave} disabled={pending}>
              {pending ? "등록 중..." : "확인 (등록)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
