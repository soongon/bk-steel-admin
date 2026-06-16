"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { FileTextIcon, PlusIcon, PrinterIcon, SaveIcon, XIcon } from "lucide-react";
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
import { type CompanyProfile } from "@/lib/company-profile";
import { type Book } from "@/lib/book";
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { isRebarItem, sortRebar, calculateRebarWeight } from "@/lib/rebar";
import { fmtKrw, fmtNum } from "@/lib/format";
import { createQuote } from "@/app/[book]/quotes/actions";

export type QuotePartner = {
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
export type QuoteItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  rebar_spec_code: string | null;
  rebar_grade_code: string | null;
  length_m: number | null;
  bars_per_tonne: number | null;
};
export type QuoteRebarSpec = {
  spec_code: string;
  unit_weight_kg_per_m: number;
  standard_length_m: number;
};

/** 견적 폼이 필요로 하는 마스터·공급자 데이터. 어느 진입점이든 이 묶음만 넘기면 재사용 가능. */
export type QuoteSources = {
  partners: QuotePartner[];
  items: QuoteItem[];
  rebarSpecs: QuoteRebarSpec[];
  company: CompanyProfile | null;
};

const UNIT_OPTIONS = [
  { value: "ea", label: "가닥/EA" },
  { value: "kg", label: "kg" },
  { value: "ton", label: "톤 (이론중량)" },
  { value: "ton_metric", label: "톤 (1,000kg)" },
] as const;

type LineDraft = {
  itemKind: "rebar" | "steel";
  itemId: string;
  unit: "ea" | "kg" | "ton";
  qty: number;
  unitPrice: number;
  tonMetric: boolean;
};

/**
 * 견적서 작성 다이얼로그 (범용·재사용).
 * 거래처는 선택(현장명·잠재명만으로도 작성), 부가세 포함/제외 토글, 멀티라인 품목(매출 폼 동일 환산).
 * book 을 주면 작성→미리보기→**저장**(quote 테이블). book 없으면 미리보기·프린트만(현장 진입 등).
 */
export function QuoteDialog({
  open,
  onOpenChange,
  sources,
  book,
  onSaved,
  defaultSiteName = "",
  defaultPartnerName = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: QuoteSources;
  book?: Book; // 있으면 저장 가능(목록 진입). 없으면 미리보기·프린트만.
  onSaved?: (id: string) => void;
  defaultSiteName?: string;
  defaultPartnerName?: string;
}) {
  const { partners, items, rebarSpecs, company } = sources;
  const [error, setError] = useState<string | null>(null);
  const [showStatement, setShowStatement] = useState(false);
  const [saving, startSaving] = useTransition();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  const [siteName, setSiteName] = useState(defaultSiteName);
  const [partnerInput, setPartnerInput] = useState(defaultPartnerName);
  const matchedPartner = partners.find((p) => p.name === partnerInput);

  const [vatExempt, setVatExempt] = useState(false); // 무자료(부가세 제외)
  const [validUntil, setValidUntil] = useState(""); // 유효기간
  const [deliveryTerms, setDeliveryTerms] = useState(""); // 납품조건
  const [paymentTerms, setPaymentTerms] = useState(""); // 결제조건

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
  const [tonMetric, setTonMetric] = useState(false);
  const [qtyStr, setQtyStr] = useState("");
  const [unitPriceStr, setUnitPriceStr] = useState("");
  const qty = Number(qtyStr) || 0;
  const unitPrice = Number(unitPriceStr) || 0;

  const [lines, setLines] = useState<LineDraft[]>([]);
  const [notes, setNotes] = useState("");

  // 매출과 동일 환산(실중량 올림 ceilWeight=true)
  const calc = useMemo(
    () => (rebarSpec ? calculateRebarWeight(selectedItem!, rebarSpec, unit, qty, unitPrice, tonMetric, true) : null),
    [rebarSpec, selectedItem, unit, qty, unitPrice, tonMetric],
  );

  const calcLine = (l: LineDraft) => {
    const lineItem = items.find((i) => i.id === l.itemId) ?? null;
    const lineSpec = lineItem?.rebar_spec_code
      ? rebarSpecs.find((s) => s.spec_code === lineItem.rebar_spec_code) ?? null
      : null;
    const c = lineItem && lineSpec ? calculateRebarWeight(lineItem, lineSpec, l.unit, l.qty, l.unitPrice, l.tonMetric, true) : null;
    return { item: lineItem, calc: c, subtotal: c ? c.subtotal : Math.round(l.unitPrice * l.qty) };
  };

  const pendingLine: LineDraft | null =
    itemId && qty > 0 && unitPrice > 0 ? { itemKind, itemId, unit, qty, unitPrice, tonMetric } : null;
  const allLines = pendingLine ? [...lines, pendingLine] : lines;

  const lineSubtotal = allLines.reduce((s, l) => s + calcLine(l).subtotal, 0);
  const vatRate = vatExempt ? 0 : 10;
  const vat = Math.round((lineSubtotal * vatRate) / 100);
  const total = lineSubtotal + vat;

  useEffect(() => {
    if (open) {
      setError(null);
      setShowStatement(false);
      setSiteName(defaultSiteName);
      setPartnerInput(defaultPartnerName);
      setVatExempt(false);
      setValidUntil("");
      setDeliveryTerms("");
      setPaymentTerms("");
      setItemId("");
      setItemKind("rebar");
      setUnit("ea");
      setTonMetric(false);
      setQtyStr("");
      setUnitPriceStr("");
      setLines([]);
      setNotes("");
    }
  }, [open, defaultSiteName, defaultPartnerName]);

  const statementData: StatementData | null = (() => {
    if (allLines.length === 0) return null;
    const stLines = allLines
      .map((l) => {
        const { item: lineItem, calc: c } = calcLine(l);
        if (!lineItem) return null;
        const isReb = !!lineItem.rebar_spec_code && !!c;
        const spec = isReb
          ? [lineItem.rebar_spec_code, lineItem.rebar_grade_code, lineItem.length_m ? `${lineItem.length_m}M` : null]
              .filter(Boolean)
              .join(" ")
          : "";
        const sub = c ? c.subtotal : Math.round(l.unitPrice * l.qty);
        const unitLabel = l.unit === "ton" ? "톤" : l.unit === "kg" ? "kg" : "EA";
        return {
          item_name: lineItem.name,
          spec,
          qty: l.qty,
          unit: unitLabel,
          unit_price_krw: l.qty > 0 ? Math.round(sub / l.qty) : l.unitPrice,
          subtotal_krw: sub,
          vat_krw: Math.round((sub * vatRate) / 100),
          weight_kg: isReb && c ? c.weightKg : null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const lineVatSum = stLines.reduce((s, ln) => s + ln.vat_krw, 0);
    return {
      doc_no: `견적-${today.replace(/-/g, "")}`,
      ordered_on: today,
      tax_doc_no: null,
      partner: {
        name: matchedPartner?.name ?? partnerInput ?? "",
        business_no: matchedPartner?.business_no ?? null,
        representative: matchedPartner?.representative ?? null,
        address: matchedPartner?.address ?? null,
        phone: matchedPartner?.phone ?? null,
        fax: matchedPartner?.fax ?? null,
        industry: matchedPartner?.industry ?? null,
      },
      site_name: siteName || null,
      is_documented: !vatExempt,
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
    if (unitPrice <= 0) { setError("단가를 입력해주세요."); return; }
    setLines((prev) => [...prev, { itemKind, itemId, unit, qty, unitPrice, tonMetric }]);
    setItemId("");
    setQtyStr("");
    setUnitPriceStr("");
    setError(null);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!siteName && !partnerInput) {
      setError("현장명 또는 거래처 중 하나는 입력해주세요.");
      return;
    }
    if (allLines.length === 0) {
      setError("품목을 1개 이상 추가해주세요.");
      return;
    }
    setShowStatement(true);
  }

  // 저장(book 있을 때) — FormData 구성 후 createQuote.
  function handleSave() {
    if (!book) return;
    const fd = new FormData();
    fd.set("book", book);
    fd.set("quote_date", today);
    if (validUntil) fd.set("valid_until", validUntil);
    if (matchedPartner) fd.set("partner_id", matchedPartner.id);
    else if (partnerInput) fd.set("prospect_name", partnerInput);
    if (siteName) fd.set("site_name", siteName);
    fd.set("is_documented", vatExempt ? "false" : "true");
    if (deliveryTerms) fd.set("delivery_terms", deliveryTerms);
    if (paymentTerms) fd.set("payment_terms", paymentTerms);
    if (notes) fd.set("notes", notes);
    fd.set(
      "lines",
      JSON.stringify(
        allLines.map((l) => {
          const { calc: c } = calcLine(l);
          return {
            item_id: l.itemId,
            unit: l.unit,
            qty: l.qty,
            unit_price_krw: l.unitPrice,
            weight_kg: c?.weightKg ?? null,
          };
        }),
      ),
    );
    startSaving(async () => {
      const r = await createQuote(fd);
      if (r.ok) {
        toast.success("견적서 저장됨");
        onOpenChange(false);
        onSaved?.(r.id ?? "");
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl print:hidden">
          <DialogHeader>
            <DialogTitle>견적서 작성</DialogTitle>
            <DialogDescription>
              거래처는 선택입니다(현장명·잠재 고객명만으로도 가능). 부가세 포함/제외를 고른 뒤 품목을 추가하세요.
              {book ? " 확인 후 저장됩니다." : " (저장 없음 — 미리보기·프린트)"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
            {/* 현장 + 거래처(선택) */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="현장명">
                <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="현장명 입력" />
              </Field>
              <Field label="거래처 (선택)">
                <Input
                  list="quote-partners"
                  value={partnerInput}
                  onChange={(e) => setPartnerInput(e.target.value)}
                  placeholder="거래처명 입력 / 선택 (생략 가능)"
                />
                <datalist id="quote-partners">
                  {partners.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
                {partnerInput && !matchedPartner ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">마스터 미등록 — 잠재 고객명으로 저장·표기</p>
                ) : null}
              </Field>
            </div>

            {/* 유효기간 + 부가세 토글 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="유효기간 (선택)">
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </Field>
              <Field label="부가세">
                <div className="flex h-8 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setVatExempt(false)}
                    className={`rounded-md border px-2.5 py-1 text-xs ${!vatExempt ? "bg-foreground text-background" : "bg-background"}`}
                  >
                    포함 (10%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVatExempt(true)}
                    className={`rounded-md border px-2.5 py-1 text-xs ${vatExempt ? "bg-foreground text-background" : "bg-background"}`}
                  >
                    제외 (무자료)
                  </button>
                </div>
              </Field>
            </div>

            {/* 품목 입력 */}
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
                <Input type="number" step="1" min="0" value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} placeholder="0" />
              </Field>
              <Field label={itemKind === "rebar" ? "단가(원/kg) *" : "단가(원) *"}>
                <Input type="number" step="1" value={unitPriceStr} onChange={(e) => setUnitPriceStr(e.target.value)} placeholder="0" />
              </Field>
            </div>

            {calc && rebarSpec ? (
              <div className="rounded-lg border border-dashed bg-muted/30 p-2 text-xs text-muted-foreground">
                환산: 가닥 <strong className="text-foreground">{calc.bars.toLocaleString()}</strong> · 실중량{" "}
                <strong className="text-foreground">{fmtNum(calc.weightKg)}kg</strong>
              </div>
            ) : null}

            {/* 추가 + 누적 */}
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <PlusIcon className="size-4" /> 품목 추가
              </Button>
              <span className="text-xs text-muted-foreground">
                {lines.length > 0 ? `추가된 품목 ${lines.length}건` : "입력 후 ‘품목 추가’ (마지막 1건 자동 포함)"}
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
                        {reb ? `${fmtNum(c!.weightKg)}kg` : `${l.qty}${l.unit}`} × {fmtKrw(l.unitPrice)}
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

            {/* 합계 */}
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

            {/* 견적 조건 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="납품조건">
                <Input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} placeholder="예: 발주 후 3일 내" />
              </Field>
              <Field label="결제조건">
                <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="예: 월말 현금" />
              </Field>
            </div>

            <Field label="메모">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="기타 견적 조건 등"
                className="resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </Field>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button type="submit">견적서 확인</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {showStatement && statementData ? (
        <Dialog open onOpenChange={(o) => { if (!o) setShowStatement(false); }}>
          <DialogContent className="!max-w-[920px] max-h-[90vh] overflow-y-auto">
            <DialogHeader className="print:hidden">
              <DialogTitle>견적서 미리보기</DialogTitle>
            </DialogHeader>
            <div className="bg-zinc-100 p-3 print:bg-white print:p-0 dark:bg-zinc-900">
              <div className="mx-auto max-w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
                <TradingStatement data={statementData} company={company} mode="quote" />
              </div>
            </div>
            <DialogFooter className="print:hidden">
              <Button variant="outline" onClick={() => setShowStatement(false)}>
                수정
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <PrinterIcon className="size-4" /> 프린트
              </Button>
              {book ? (
                <Button onClick={handleSave} disabled={saving}>
                  <SaveIcon className="size-4" /> {saving ? "저장 중..." : "저장"}
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** 트리거 버튼 + QuoteDialog. 버튼 하나로 끝낼 때 사용(현장 상세 등 — 저장 없이 미리보기). */
export function QuoteButton({
  sources,
  book,
  onSaved,
  defaultSiteName,
  defaultPartnerName,
  label = "견적서 작성",
  variant = "default",
  size = "sm",
}: {
  sources: QuoteSources;
  book?: Book;
  onSaved?: (id: string) => void;
  defaultSiteName?: string;
  defaultPartnerName?: string;
  label?: string;
  variant?: "default" | "outline" | "secondary";
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <FileTextIcon className="size-4" />
        {label}
      </Button>
      <QuoteDialog
        open={open}
        onOpenChange={setOpen}
        sources={sources}
        book={book}
        onSaved={onSaved}
        defaultSiteName={defaultSiteName}
        defaultPartnerName={defaultPartnerName}
      />
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
