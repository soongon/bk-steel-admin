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
import { createSale, updateSaleHeader } from "./actions";

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

export type SaleRow = {
  id: string;
  book: Book;
  doc_no: string;
  partner_id: string;
  site_name: string | null;
  ordered_on: string;
  delivered_on: string | null;
  status: string;
  is_documented: boolean;
  tax_doc_type: string;
  payment_due_on: string | null;
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
  { value: "reserved", label: "주문 (미납품)" },
  { value: "confirmed", label: "확정" },
  { value: "delivered", label: "납품완료" },
  { value: "settled", label: "수금완료" },
] as const;

const UNIT_OPTIONS = [
  { value: "ea", label: "가닥/EA" },
  { value: "kg", label: "kg" },
  { value: "ton", label: "톤" },
  { value: "bundle", label: "번들" },
] as const;

const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const fmtNum = (n: number, d = 1) => n.toLocaleString("ko-KR", { maximumFractionDigits: d });

export function SaleFormDialog({
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
  editing: SaleRow | null;
  view: BookView;
  partners: Partner[];
  items: Item[];
  rebarSpecs: RebarSpec[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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

  // 단위·수량·단가
  const [unit, setUnit] = useState<"ea" | "kg" | "ton" | "bundle">("ea");
  const [qtyStr, setQtyStr] = useState("");
  const [unitPriceStr, setUnitPriceStr] = useState("");
  const qty = Number(qtyStr) || 0;
  const unitPrice = Number(unitPriceStr) || 0;

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

  // 환산 계산 (rebar)
  const calc = useMemo(() => {
    if (!rebarSpec || qty <= 0) return null;
    const lengthM = selectedItem?.length_m ?? rebarSpec.standard_length_m ?? 8;
    const kgPerBar = rebarSpec.unit_weight_kg_per_m * lengthM;
    let bars = 0;
    let weightKg = 0;
    if (unit === "ea") {
      bars = qty;
      weightKg = bars * kgPerBar;
    } else if (unit === "kg") {
      weightKg = qty;
      bars = Math.ceil(weightKg / kgPerBar);
    } else if (unit === "ton") {
      weightKg = qty * 1000;
      bars = Math.ceil(weightKg / kgPerBar);
    } else if (unit === "bundle") {
      const barsPerBundle = rebarSpec.bars_per_bundle ?? 0;
      bars = qty * barsPerBundle;
      weightKg = bars * kgPerBar;
    }
    const subtotal = Math.round(unitPrice * qty);
    return { bars, weightKg, kgPerBar, lengthM, subtotal };
  }, [rebarSpec, selectedItem, unit, qty, unitPrice]);

  // 세금 계산
  const lineSubtotal = calc ? calc.subtotal : Math.round(unitPrice * qty);
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
  const [notes, setNotes] = useState(editing?.notes ?? "");

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
        setUnit("ea");
        setQtyStr("");
        setUnitPriceStr("");
        setOrderedOn(today);
        setDeliveredOn("");
        setPaymentDueOn("");
        setStatus("reserved");
        setNotes("");
      }
    }
  }, [open, editing, view, today]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!editing) {
      if (!matchedPartner) {
        setError("거래처는 마스터에 등록된 이름을 정확히 선택해주세요.");
        return;
      }
      if (!itemId) {
        setError("품목을 선택해주세요.");
        return;
      }
    }

    const fd = new FormData();
    fd.set("book", book);
    fd.set("ordered_on", orderedOn);
    fd.set("delivered_on", deliveredOn);
    fd.set("payment_due_on", paymentDueOn);
    fd.set("status", status);
    fd.set("is_documented", String(isDocumented));
    fd.set("tax_doc_type", taxDocType);
    fd.set("site_name", siteName);
    fd.set("notes", notes);

    if (!editing) {
      fd.set("partner_id", matchedPartner!.id);
      fd.set("item_id", itemId);
      fd.set("unit", unit);
      fd.set("qty", String(qty));
      fd.set("unit_price_krw", String(unitPrice));
      if (calc) fd.set("weight_kg", String(calc.weightKg));
    }

    startTransition(async () => {
      const result = editing
        ? await updateSaleHeader(editing.id, fd)
        : await createSale(fd);
      if (result.ok) {
        toast.success(editing ? "매출이 수정되었습니다" : "매출이 등록되었습니다");
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
          <DialogTitle>{editing ? "매출 수정" : "신규 매출"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "라인 항목은 수정 불가 (취소 후 재등록). 헤더 정보만 변경됩니다."
              : "거래처는 등록된 마스터에서 선택. 철근 단위는 자동 환산됩니다."}
          </DialogDescription>
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
                <p className="mt-0.5 text-xs text-amber-600">
                  마스터에 없는 거래처입니다 — 먼저 거래처 페이지에서 등록하세요
                </p>
              ) : null}
            </Field>
          </div>

          {/* 현장 + 주문일 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="현장">
              <Input
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="안강 / 언양공장 / ..."
              />
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
                <Field label="수량 *">
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

              {/* 환산 표시 (rebar) */}
              {calc && rebarSpec ? (
                <div className="rounded-lg border border-dashed bg-muted/30 p-2 text-xs">
                  <p className="mb-1 font-medium text-muted-foreground">철근 환산</p>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <span>가닥: <strong>{calc.bars.toLocaleString()}</strong></span>
                    <span>중량: <strong>{fmtNum(calc.weightKg)}kg</strong> ({fmtNum(calc.weightKg / 1000, 3)}톤)</span>
                    <span>단위중량: {rebarSpec.unit_weight_kg_per_m}kg/m × {calc.lengthM}m</span>
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
