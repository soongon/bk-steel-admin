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
import { type Book, type BookView, BOOK_LABEL, BOOKS } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import { createPurchase, updatePurchaseHeader } from "./actions";

export type Partner = { id: string; code: string; name: string };
export type Item = {
  id: string;
  code: string;
  name: string;
  category: string;
  rebar_spec_code: string | null;
  rebar_grade_code: string | null;
  length_m: number | null;
};
export type RebarSpec = {
  spec_code: string;
  unit_weight_kg_per_m: number;
  standard_length_m: number;
  bars_per_bundle: number | null;
  bundle_weight_kg: number | null;
};

export type PurchaseRow = {
  id: string;
  book: Book;
  doc_no: string;
  partner_id: string;
  ordered_on: string;
  delivered_on: string | null;
  paid_on: string | null;
  payment_due_on: string | null;
  status: string;
  is_documented: boolean;
  tax_doc_type: string;
  tax_doc_no: string | null;
  notes: string | null;
};

const TAX_DOC_OPTIONS = [
  { value: "tax_invoice_electronic", label: "전자세금계산서" },
  { value: "tax_invoice_paper", label: "종이세금계산서" },
  { value: "invoice", label: "계산서 (면세)" },
  { value: "cash_receipt", label: "현금영수증" },
  { value: "simple_receipt", label: "간이영수증" },
  { value: "none", label: "무자료" },
] as const;

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
  { value: "bundle", label: "번들" },
] as const;

const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const fmtNum = (n: number, d = 1) => n.toLocaleString("ko-KR", { maximumFractionDigits: d });

export function PurchaseFormDialog({
  open,
  onOpenChange,
  editing,
  view,
  partners,
  items,
  rebarSpecs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PurchaseRow | null;
  view: BookView;
  partners: Partner[];
  items: Item[];
  rebarSpecs: RebarSpec[];
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

  const [itemId, setItemId] = useState("");
  const selectedItem = items.find((i) => i.id === itemId);
  const rebarSpec = selectedItem?.rebar_spec_code
    ? rebarSpecs.find((s) => s.spec_code === selectedItem.rebar_spec_code)
    : null;

  const [unit, setUnit] = useState<"ea" | "kg" | "ton" | "bundle">("ea");
  const [qtyStr, setQtyStr] = useState("");
  const [unitPriceStr, setUnitPriceStr] = useState("");
  const qty = Number(qtyStr) || 0;
  const unitPrice = Number(unitPriceStr) || 0;

  // 실중량 (kg 단위가 아닐 때만 별도 입력. kg 단위면 qty가 곧 실중량)
  const [actualWeightStr, setActualWeightStr] = useState("");

  const [isDocumented, setIsDocumented] = useState(book === "b" ? false : true);
  const [taxDocType, setTaxDocType] = useState<string>(
    book === "b" ? "none" : "tax_invoice_electronic",
  );
  const [taxDocNo, setTaxDocNo] = useState("");

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

  // 환산
  const calc = useMemo(() => {
    if (!rebarSpec || qty <= 0) return null;
    const lengthM = selectedItem?.length_m ?? rebarSpec.standard_length_m ?? 8;
    const kgPerBar = rebarSpec.unit_weight_kg_per_m * lengthM;
    let bars = 0;
    let theoreticalKg = 0;
    if (unit === "ea") {
      bars = qty;
      theoreticalKg = bars * kgPerBar;
    } else if (unit === "kg") {
      theoreticalKg = qty;
      bars = Math.ceil(qty / kgPerBar);
    } else if (unit === "ton") {
      theoreticalKg = qty * 1000;
      bars = Math.ceil(theoreticalKg / kgPerBar);
    } else if (unit === "bundle") {
      const barsPerBundle = rebarSpec.bars_per_bundle ?? 0;
      bars = qty * barsPerBundle;
      theoreticalKg = bars * kgPerBar;
    }
    const subtotal = Math.round(unitPrice * qty);
    return { bars, theoreticalKg, kgPerBar, lengthM, subtotal };
  }, [rebarSpec, selectedItem, unit, qty, unitPrice]);

  const lineSubtotal = calc ? calc.subtotal : Math.round(unitPrice * qty);
  const vatRate =
    isDocumented && taxDocType !== "invoice" && taxDocType !== "none" ? 10 : 0;
  const vat = Math.round((lineSubtotal * vatRate) / 100);
  const total = lineSubtotal + vat;

  const [orderedOn, setOrderedOn] = useState(today);
  const [deliveredOn, setDeliveredOn] = useState("");
  const [paymentDueOn, setPaymentDueOn] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [status, setStatus] = useState<string>(editing?.status ?? "ordered");
  const [notes, setNotes] = useState(editing?.notes ?? "");

  useEffect(() => {
    if (open) {
      setError(null);
      if (editing) {
        setBook(editing.book);
        setOrderedOn(editing.ordered_on);
        setDeliveredOn(editing.delivered_on ?? "");
        setPaymentDueOn(editing.payment_due_on ?? "");
        setPaidOn(editing.paid_on ?? "");
        setStatus(editing.status);
        setIsDocumented(editing.is_documented);
        setTaxDocType(editing.tax_doc_type);
        setTaxDocNo(editing.tax_doc_no ?? "");
        setNotes(editing.notes ?? "");
      } else {
        setBook(view !== "all" ? (view as Book) : "sl");
        setPartnerInput("");
        setItemId("");
        setUnit("ea");
        setQtyStr("");
        setUnitPriceStr("");
        setActualWeightStr("");
        setOrderedOn(today);
        setDeliveredOn("");
        setPaymentDueOn("");
        setPaidOn("");
        setStatus("ordered");
        setTaxDocNo("");
        setNotes("");
      }
    }
  }, [open, editing, view, today]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!editing) {
      if (!matchedPartner) {
        setError("매입처는 거래처 마스터에 등록된 이름을 정확히 선택해주세요.");
        return;
      }
      if (!itemId) {
        setError("품목을 선택해주세요.");
        return;
      }
      if (unit === "kg") {
        // kg 단위면 qty 자체가 실중량 → actual_weight_kg = qty
      } else if (actualWeightStr === "" && rebarSpec) {
        // 가닥/톤/번들이면 actual은 선택 (이론중량은 자동)
      }
    }

    const fd = new FormData();
    fd.set("book", book);
    fd.set("ordered_on", orderedOn);
    fd.set("delivered_on", deliveredOn);
    fd.set("payment_due_on", paymentDueOn);
    fd.set("paid_on", paidOn);
    fd.set("status", status);
    fd.set("is_documented", String(isDocumented));
    fd.set("tax_doc_type", taxDocType);
    fd.set("tax_doc_no", taxDocNo);
    fd.set("notes", notes);

    if (!editing) {
      fd.set("partner_id", matchedPartner!.id);
      fd.set("item_id", itemId);
      fd.set("unit", unit);
      fd.set("qty", String(qty));
      fd.set("unit_price_krw", String(unitPrice));
      if (calc) {
        fd.set("theoretical_weight_kg", String(calc.theoreticalKg));
        if (calc.bars > 0) fd.set("bars_count", String(calc.bars));
      }
      if (unit === "kg") {
        fd.set("actual_weight_kg", String(qty));
      } else if (actualWeightStr) {
        fd.set("actual_weight_kg", actualWeightStr);
      }
    }

    startTransition(async () => {
      const result = editing
        ? await updatePurchaseHeader(editing.id, fd)
        : await createPurchase(fd);
      if (result.ok) {
        toast.success(editing ? "매입이 수정되었습니다" : "매입이 등록되었습니다");
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "매입 수정" : "신규 매입"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "라인 항목은 수정 불가. 헤더만 변경됩니다."
              : "kg 단위는 실중량(검수)으로 입력. 가닥/톤은 이론중량 자동 계산."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* 책 + 매입처 */}
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
                <p className="mt-0.5 text-xs text-amber-600">
                  마스터에 없는 거래처 — 거래처 페이지에서 먼저 등록하세요
                </p>
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

          {/* 신규: 품목 + 단위 + 수량 + 단가 */}
          {!editing ? (
            <>
              <Field label="품목 *">
                <select
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  required
                >
                  <option value="">— 선택 —</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="단위 *">
                  <select
                    value={unit}
                    onChange={(e) =>
                      setUnit(e.target.value as "ea" | "kg" | "ton" | "bundle")
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
                    step="0.001"
                    value={qtyStr}
                    onChange={(e) => setQtyStr(e.target.value)}
                    placeholder="0"
                    required
                  />
                </Field>
                <Field label="단가(원) *">
                  <Input
                    type="number"
                    step="1"
                    value={unitPriceStr}
                    onChange={(e) => setUnitPriceStr(e.target.value)}
                    placeholder="0"
                    required
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
                    placeholder={`이론 ${calc ? fmtNum(calc.theoreticalKg) : "0"}kg — 비우면 이론중량 사용`}
                  />
                </Field>
              ) : null}

              {/* 환산 표시 */}
              {calc && rebarSpec ? (
                <div className="rounded-lg border border-dashed bg-muted/30 p-2 text-xs">
                  <p className="mb-1 font-medium text-muted-foreground">철근 환산</p>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <span>가닥: <strong>{calc.bars.toLocaleString()}</strong></span>
                    <span>이론중량: <strong>{fmtNum(calc.theoreticalKg)}kg</strong> ({fmtNum(calc.theoreticalKg / 1000, 3)}톤)</span>
                    <span>단위: {rebarSpec.unit_weight_kg_per_m}kg/m × {calc.lengthM}m</span>
                  </div>
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

          {/* 세금계산서 + 상태 */}
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
            <Field label="세금계산서 번호">
              <Input
                value={taxDocNo}
                onChange={(e) => setTaxDocNo(e.target.value)}
                placeholder="20260507-00001"
              />
            </Field>
          </div>

          {/* 상태 + 결제 */}
          <div className="grid grid-cols-3 gap-3">
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
            <Field label="결제 예정일">
              <Input
                type="date"
                value={paymentDueOn}
                onChange={(e) => setPaymentDueOn(e.target.value)}
              />
            </Field>
            <Field label="결제일">
              <Input
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
