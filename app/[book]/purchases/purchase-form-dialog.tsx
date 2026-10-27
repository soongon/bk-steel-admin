"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/admin/field";
import { PlusIcon, XIcon } from "lucide-react";
import { type Book, type BookView, BOOK_LABEL, BOOKS } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { isRebarItem, sortRebar, calculateRebarWeight } from "@/lib/rebar";
import { fmtKrw, fmtNum } from "@/lib/format";
import { TAX_DOC_OPTIONS } from "@/lib/tax-doc";
import {
  type PurchaseLineDraft,
  calcPurchaseLine,
  serializePurchaseLines,
  withAdjustmentLine,
} from "@/lib/purchase-line-draft";
import { createPurchase, updatePurchaseHeader, updatePurchaseLines } from "./actions";

export type Partner = { id: string; code: string; name: string };
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

export type SiteOption = { id: string; name: string };

export type PurchaseRow = {
  id: string;
  book: Book;
  doc_no: string;
  partner_id: string;
  site_id: string | null;
  site_name: string | null;
  ordered_on: string;
  delivered_on: string | null;
  paid_on: string | null;
  payment_due_on: string | null;
  status: string;
  is_documented: boolean;
  tax_doc_type: string;
  tax_doc_no: string | null;
  notes: string | null;
  /** 수정 모드 라인 편집(0093) — 상세 페이지가 기존 purchase_line 을 PurchaseLineDraft 로 채워 넘긴다. 없으면 헤더만 수정. */
  lines?: PurchaseLineDraft[];
  /** 현재 공급가액 — 홈택스 수집본과 연결돼 있으면 라인 합이 이 값과 같아야 저장된다. */
  subtotal_krw?: number;
  total_krw?: number;
  origin?: string | null;
  /** 연결된 홈택스 매입 계산서(hometax_invoice.purchase_id) — 있으면 합계 고정 안내 + 차액 맞춤 버튼. */
  invoice?: { supply_krw: number; total_krw: number; nts_confirm_num: string | null } | null;
};

const STATUS_OPTIONS = [
  { value: "ordered", label: "발주" },
  { value: "in_stock", label: "입고완료" },
  { value: "depleted", label: "전량 출고" },
  { value: "scrapped", label: "폐기" },
] as const;

const UNIT_OPTIONS = [
  { value: "ea", label: "가닥/EA" },
  { value: "kg", label: "kg (실중량)" },
  { value: "ton", label: "톤 (이론중량)" },
] as const;

export function PurchaseFormDialog({
  open,
  onOpenChange,
  editing,
  view,
  partners,
  items,
  rebarSpecs,
  sites,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PurchaseRow | null;
  view: BookView;
  partners: Partner[];
  items: Item[];
  rebarSpecs: RebarSpec[];
  sites: SiteOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const [book, setBook] = useState<Book>(
    editing?.book ?? (view !== "all" ? (view as Book) : "sl"),
  );

  const partnerInitial = editing ? partners.find((p) => p.id === editing.partner_id) : null;
  const [partnerInput, setPartnerInput] = useState(partnerInitial?.name ?? "");
  const matchedPartner = partners.find((p) => p.name === partnerInput);

  const [siteName, setSiteName] = useState(editing?.site_name ?? "");
  const matchedSite = sites.find((s) => s.name === siteName);

  // 품목 구분(철근/철제) — 매출 폼과 동일. 토글 시 선택 초기화.
  const [itemKind, setItemKind] = useState<"rebar" | "steel">("rebar");
  const itemOptions = useMemo(
    () =>
      itemKind === "rebar"
        ? items.filter(isRebarItem).sort(sortRebar)
        : items.filter((i) => !isRebarItem(i)).sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [items, itemKind],
  );

  const [itemId, setItemId] = useState("");
  const selectedItem = items.find((i) => i.id === itemId);
  const rebarSpec = selectedItem?.rebar_spec_code
    ? rebarSpecs.find((s) => s.spec_code === selectedItem.rebar_spec_code)
    : null;

  const [unit, setUnit] = useState<"ea" | "kg" | "ton">("ea");
  const [qtyStr, setQtyStr] = useState("");
  const [unitPriceStr, setUnitPriceStr] = useState("");
  const qty = Number(qtyStr) || 0;
  const unitPrice = Number(unitPriceStr) || 0;

  // 실중량 (kg 단위가 아닐 때만 별도 입력. kg 단위면 qty가 곧 실중량)
  const [actualWeightStr, setActualWeightStr] = useState("");
  const actualWeight = actualWeightStr ? Number(actualWeightStr) : null;

  // 누적 품목 라인 (신규 등록 — 여러 품목 / 수정 — 기존 라인 프리필 후 추가·삭제)
  const [lines, setLines] = useState<PurchaseLineDraft[]>([]);
  // 수정 모드 라인 편집은 상세 페이지가 editing.lines 를 넘길 때만(목록의 헤더 전용 호출과 구분).
  const canEditLines = !editing || editing.lines !== undefined;

  const [isDocumented, setIsDocumented] = useState(book === "b" ? false : true);
  const [taxDocType, setTaxDocType] = useState<string>(
    book === "b" ? "none" : "tax_invoice_electronic",
  );

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
  }, [book]); // eslint-disable-line react-hooks/exhaustive-deps

  // 현재 입력 라인 환산 미리보기 (weightKg = 이론중량)
  const calc = useMemo(
    () => (rebarSpec ? calculateRebarWeight(selectedItem!, rebarSpec, unit, qty, unitPrice) : null),
    [rebarSpec, selectedItem, unit, qty, unitPrice],
  );

  // 라인 → 품목·환산·공급가 (목록·합계 공용). 실중량 있으면 우선, 없으면 이론중량.
  const calcLine = (l: PurchaseLineDraft) => calcPurchaseLine(items, rebarSpecs, l);

  // 현재 입력이 유효하면 임시 라인으로 포함(추가 안 눌러도 마지막 1건 반영)
  const pendingLine: PurchaseLineDraft | null =
    itemId && qty > 0 && unitPrice > 0
      ? { itemKind, itemId, unit, qty, unitPrice, actualWeight: unit === "kg" ? qty : actualWeight }
      : null;
  const allLines = pendingLine ? [...lines, pendingLine] : lines;

  // 세금·합계 — 모든 라인 공급가 합
  const lineSubtotal = allLines.reduce((s, l) => s + calcLine(l).subtotal, 0);
  const vatRate =
    isDocumented && taxDocType !== "invoice" && taxDocType !== "none" ? 10 : 0;
  const vat = Math.round((lineSubtotal * vatRate) / 100);
  const total = lineSubtotal + vat;

  // 홈택스 수집본과 연결 — 합계 고정: 목표 공급가액(= 현재 헤더 공급가액 = 국세청 계산서)과의 차액.
  const fixedSubtotal = editing?.invoice ? Number(editing.subtotal_krw ?? editing.invoice.supply_krw) : null;
  const invoiceDiff = fixedSubtotal != null ? fixedSubtotal - lineSubtotal : 0;
  // 라인이 바뀌었는지 — 직렬화 비교(수정 모드에서 안 바뀌면 라인 RPC 를 부르지 않는다).
  const linesDirty =
    !!editing &&
    canEditLines &&
    serializePurchaseLines(items, rebarSpecs, allLines) !== serializePurchaseLines(items, rebarSpecs, editing.lines ?? []);

  const [orderedOn, setOrderedOn] = useState(today);
  const [deliveredOn, setDeliveredOn] = useState(today);
  const [status, setStatus] = useState<string>(editing?.status ?? "ordered");
  const [notes, setNotes] = useState(editing?.notes ?? "");

  useEffect(() => {
    if (open) {
      setError(null);
      if (editing) {
        setBook(editing.book);
        setSiteName(editing.site_name ?? "");
        setOrderedOn(editing.ordered_on);
        setDeliveredOn(editing.delivered_on ?? "");
        setStatus(editing.status);
        setIsDocumented(editing.is_documented);
        setTaxDocType(editing.tax_doc_type);
        setNotes(editing.notes ?? "");
        // 라인 편집 — 기존 라인 프리필, 입력칸 초기화.
        setLines(editing.lines ?? []);
        setItemId("");
        setItemKind("rebar");
        setUnit("ea");
        setQtyStr("");
        setUnitPriceStr("");
        setActualWeightStr("");
      } else {
        setBook(view !== "all" ? (view as Book) : "sl");
        setPartnerInput("");
        setSiteName("");
        setItemId("");
        setItemKind("rebar");
        setUnit("ea");
        setQtyStr("");
        setUnitPriceStr("");
        setActualWeightStr("");
        setLines([]);
        setOrderedOn(today);
        setDeliveredOn(today);
        setStatus("ordered");
        setNotes("");
      }
    }
  }, [open, editing, view, today]);

  function addLine() {
    if (!itemId) { setError("품목을 선택해주세요."); return; }
    if (qty <= 0) { setError("수량을 입력해주세요."); return; }
    if (unitPrice <= 0) { setError("단가를 입력해주세요."); return; }
    setLines((prev) => [...prev, { itemKind, itemId, unit, qty, unitPrice, actualWeight: unit === "kg" ? qty : actualWeight }]);
    setItemId("");
    setQtyStr("");
    setUnitPriceStr("");
    setActualWeightStr("");
    setError(null);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }
  /** 계산서 금액 맞춤 — 홈택스 계산서 공급가액과 라인 합의 차액을 조정 라인 1줄로(여러 번 눌러도 1줄). */
  function addAdjustmentLine() {
    if (fixedSubtotal == null) return;
    const base = [...lines, ...(pendingLine ? [pendingLine] : [])];
    const next = withAdjustmentLine(items, rebarSpecs, base, fixedSubtotal, editing?.invoice?.nts_confirm_num ?? null, fmtKrw);
    setLines(next.lines);
    if (pendingLine) {
      setItemId("");
      setQtyStr("");
      setUnitPriceStr("");
      setActualWeightStr("");
    }
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!editing) {
      if (!partnerInput.trim()) {
        setError("매입처를 입력해주세요.");
        return;
      }
      if (allLines.length === 0) {
        setError("품목을 1개 이상 추가해주세요.");
        return;
      }
    }
    if (editing && canEditLines && linesDirty) {
      if (allLines.length === 0) {
        setError("품목을 1개 이상 남겨주세요.");
        return;
      }
      if (fixedSubtotal != null && invoiceDiff !== 0) {
        setError(
          `홈택스 계산서 공급가액(${fmtKrw(fixedSubtotal)})과 라인 합이 ${fmtKrw(Math.abs(invoiceDiff))} 다릅니다 — '계산서 금액 맞춤'으로 차액을 넣거나 라인을 고치세요.`,
        );
        return;
      }
    }

    const fd = new FormData();
    fd.set("book", book);
    fd.set("site_name", siteName);
    if (matchedSite) fd.set("site_id", matchedSite.id);
    fd.set("ordered_on", orderedOn);
    fd.set("delivered_on", deliveredOn);
    fd.set("status", status);
    fd.set("is_documented", String(isDocumented));
    fd.set("tax_doc_type", taxDocType);
    fd.set("notes", notes);

    // 모든 라인(추가분 + 현재 입력) — 철근 환산중량·가닥수·실중량·비고 동봉.
    const linesJson = serializePurchaseLines(items, rebarSpecs, allLines);
    if (!editing) {
      // 매입처: 마스터 매칭되면 id, 아니면 이름만 — 서버(resolvePartnerId)가 없으면 자동 생성.
      if (matchedPartner) fd.set("partner_id", matchedPartner.id);
      fd.set("partner_name", partnerInput.trim());
      fd.set("lines", linesJson);
    }

    startTransition(async () => {
      if (editing) {
        // 라인이 바뀌었으면 먼저 교체(RPC 가 계산서 합계·결제완료·재고 이력 가드) → 그다음 헤더(새 공급가액으로 부가세 재계산).
        if (linesDirty) {
          const r1 = await updatePurchaseLines(editing.id, linesJson);
          if (!r1.ok) {
            setError(r1.error);
            return;
          }
        }
        const r2 = await updatePurchaseHeader(editing.id, fd);
        if (!r2.ok) {
          setError(linesDirty ? `품목은 저장되었지만 나머지 저장에 실패했습니다: ${r2.error}` : r2.error);
          return;
        }
        toast.success("매입이 수정되었습니다");
        onOpenChange(false);
        return;
      }
      const result = await createPurchase(fd);
      if (result.ok) {
        toast.success("매입이 등록되었습니다");
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "매입 수정" : "신규 매입"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* 책 */}
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

          {/* 매입처 + 현장 (나란히) */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="매입처 *">
              <Input
                list="purchase-partners-list"
                value={partnerInput}
                onChange={(e) => setPartnerInput(e.target.value)}
                placeholder="매입처명 입력 / 선택"
                disabled={!!editing}
                required
              />
              <datalist id="purchase-partners-list">
                {partners.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
              {!editing && partnerInput && !matchedPartner ? (
                <p className="mt-0.5 text-[10px] text-amber-600">
                  미등록 매입처 — 저장 시 자동 생성됩니다
                </p>
              ) : null}
            </Field>
            <Field label="현장">
              <Input
                list="purchase-site-list"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="현장 검색·신규 입력 (선택)"
              />
              <datalist id="purchase-site-list">
                {sites.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              {siteName && !matchedSite ? (
                <p className="text-[10px] text-amber-600">미등록 현장 — 저장 시 자동 생성됩니다</p>
              ) : null}
            </Field>
          </div>

          {/* 발주일 + 입고일 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="발주일 *">
              <Input
                type="date"
                value={orderedOn}
                onChange={(e) => setOrderedOn(e.target.value)}
                disabled={!!editing}
                required
              />
            </Field>
            <Field label="입고일">
              <Input
                type="date"
                value={deliveredOn}
                onChange={(e) => setDeliveredOn(e.target.value)}
              />
            </Field>
          </div>

          {/* 품목 + 단위 + 수량 + 단가 — 신규, 그리고 상세에서 연 수정(기존 라인 프리필·추가·삭제) */}
          {canEditLines ? (
            <>
              {editing?.origin === "hometax" ? (
                <p className="rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-[11px] text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300">
                  홈택스 매입 계산서로 자동 생성된 매입 — ‘홈택스 계산서분’ 줄을 지우고 실제 품목을 kg 단위(계근 실중량)로 추가하세요. 남는 차액은 아래 ‘계산서 금액 맞춤’으로 넣습니다.
                </p>
              ) : null}
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
                    value={unit}
                    onChange={(e) =>
                      setUnit(e.target.value as "ea" | "kg" | "ton")
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={unit === "kg" ? "수량(=실중량) *" : "수량 *"}>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={qtyStr}
                    onChange={(e) => setQtyStr(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label={rebarSpec ? "단가(원/kg) *" : "단가(원) *"}>
                  <Input
                    type="number"
                    step="1"
                    value={unitPriceStr}
                    onChange={(e) => setUnitPriceStr(e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>

              {/* 가닥/톤/번들 단위일 때 실중량 별도 입력 (검수 후 측정 시) */}
              {unit !== "kg" && rebarSpec ? (
                <Field label="실중량 (kg, 선택 — 검수 후 측정한 실제 중량)">
                  <Input
                    type="number"
                    step="0.001"
                    value={actualWeightStr}
                    onChange={(e) => setActualWeightStr(e.target.value)}
                    placeholder={`이론 ${calc ? fmtNum(calc.weightKg) : "0"}kg — 비우면 이론중량 사용`}
                  />
                </Field>
              ) : null}

              {/* 환산 표시 */}
              {calc && rebarSpec ? (
                <div className="rounded-lg border border-dashed bg-muted/30 p-2 text-xs">
                  <p className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground">
                    철근 환산
                    {calc.tonStd ? (
                      <span className="rounded bg-amber-100 px-1 text-[10px] font-normal text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                        명목 {qty}톤 → 표준 {selectedItem?.bars_per_tonne}본/톤
                      </span>
                    ) : null}
                  </p>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <span>가닥: <strong>{calc.bars.toLocaleString()}</strong></span>
                    <span>이론중량: <strong>{fmtNum(calc.weightKg)}kg</strong> ({fmtNum(calc.weightKg / 1000, 3)}톤)</span>
                    <span>단위: {rebarSpec.unit_weight_kg_per_m}kg/m × {calc.lengthM}m</span>
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
                    const { item: li, calc: c, theoreticalKg, subtotal: sub } = calcLine(l);
                    const reb = !!li?.rebar_spec_code && !!c;
                    const w = l.actualWeight ?? theoreticalKg;
                    return (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span className="flex-1 truncate font-medium" title={l.notes ?? undefined}>
                          {li?.name ?? "—"}
                          {l.notes?.trim() ? <span className="font-normal text-muted-foreground"> {l.notes.trim()}</span> : null}
                          {l.adjustment ? (
                            <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-normal text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">조정</span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground">
                          {reb && w ? `${fmtNum(w)}kg` : `${l.qty}${l.unit}`} × {fmtKrw(l.unitPrice)}
                          {reb ? "/kg" : ""}
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

              {/* 홈택스 수집본 연결 — 합계 고정 안내 + 차액 맞춤 */}
              {editing?.invoice && fixedSubtotal != null ? (
                <div className="flex flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="font-medium text-amber-800 dark:text-amber-300">
                    계산서 합계 {fmtKrw(Number(editing.total_krw ?? editing.invoice.total_krw))} 고정(공급가액 {fmtKrw(fixedSubtotal)}) — 라인 합이 같아야 저장
                    {editing.invoice.nts_confirm_num ? (
                      <span className="font-normal text-amber-700/80 dark:text-amber-400/80"> · 승인 …{editing.invoice.nts_confirm_num.slice(-6)}</span>
                    ) : null}
                  </p>
                  {invoiceDiff !== 0 ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="tabular-nums text-red-700 dark:text-red-300">
                        차액 {invoiceDiff > 0 ? "+" : "−"}{fmtKrw(Math.abs(invoiceDiff))} (라인 합 {fmtKrw(lineSubtotal)})
                      </span>
                      <Button type="button" variant="outline" size="sm" onClick={addAdjustmentLine}>
                        계산서 금액 맞춤
                      </Button>
                    </div>
                  ) : (
                    <p className="text-emerald-700 dark:text-emerald-300">라인 합이 계산서 공급가액과 같습니다.</p>
                  )}
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

          {/* 세금계산서 종류 + 상태 (결제완료는 목록의 '결제' 버튼=통장 출금으로) */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="세금계산서 종류">
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
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* 메모 */}
          <Field label="메모">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="건천 영남펌프카 / 선결재 / ... 자유 메모"
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
  );
}
