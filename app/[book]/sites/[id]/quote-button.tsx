"use client";

import { useEffect, useMemo, useState } from "react";
import { FileTextIcon, PlusIcon, PrinterIcon, XIcon } from "lucide-react";
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
import { TradingStatement, type StatementData } from "@/components/admin/trading-statement";
import { isRebarItem, sortRebar, calculateRebarWeight } from "@/lib/rebar";
import { fmtKrw, fmtNum } from "@/lib/format";

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

/** 현장 대상 견적서 작성 — 버튼→폼(매출 폼 패턴)→견적서 모달. DB 저장 없음(작성·출력만). */
export function QuoteButton({
  siteName,
  partners,
  items,
  rebarSpecs,
  company,
}: {
  siteName: string;
  partners: QuotePartner[];
  items: QuoteItem[];
  rebarSpecs: QuoteRebarSpec[];
  company: CompanyProfile | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStatement, setShowStatement] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const [partnerInput, setPartnerInput] = useState("");
  const matchedPartner = partners.find((p) => p.name === partnerInput);

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
  const vatRate = 10; // 견적은 부가세 별도 표기 기본 10%
  const vat = Math.round((lineSubtotal * vatRate) / 100);
  const total = lineSubtotal + vat;

  useEffect(() => {
    if (open) {
      setError(null);
      setShowStatement(false);
      setPartnerInput("");
      setItemId("");
      setItemKind("rebar");
      setUnit("ea");
      setTonMetric(false);
      setQtyStr("");
      setUnitPriceStr("");
      setLines([]);
      setNotes("");
    }
  }, [open]);

  const statementData: StatementData | null = (() => {
    if (!matchedPartner || allLines.length === 0) return null;
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
        name: matchedPartner.name,
        business_no: matchedPartner.business_no ?? null,
        representative: matchedPartner.representative ?? null,
        address: matchedPartner.address ?? null,
        phone: matchedPartner.phone ?? null,
        fax: matchedPartner.fax ?? null,
        industry: matchedPartner.industry ?? null,
      },
      site_name: siteName || null,
      is_documented: true,
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
    if (!matchedPartner) {
      setError("거래처는 마스터에 등록된 이름을 정확히 선택해주세요.");
      return;
    }
    if (allLines.length === 0) {
      setError("품목을 1개 이상 추가해주세요.");
      return;
    }
    setShowStatement(true);
  }

  return (
    <>
      <Button variant="default" size="sm" onClick={() => setOpen(true)}>
        <FileTextIcon className="size-4" />
        견적서 작성
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl print:hidden">
          <DialogHeader>
            <DialogTitle>견적서 작성</DialogTitle>
            <DialogDescription>
              {siteName} 현장 — 거래처·품목을 입력하면 견적서를 미리보고 출력합니다. (저장 없음)
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* 거래처 + 현장 */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="거래처 *">
                <Input
                  list="quote-partners"
                  value={partnerInput}
                  onChange={(e) => setPartnerInput(e.target.value)}
                  placeholder="거래처명 입력 / 선택"
                />
                <datalist id="quote-partners">
                  {partners.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
                {partnerInput && !matchedPartner ? (
                  <p className="mt-0.5 text-xs text-amber-600">마스터에 없는 거래처입니다</p>
                ) : null}
              </Field>
              <Field label="현장">
                <div className="flex h-8 items-center px-1 text-sm font-medium">{siteName}</div>
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
                <span className="text-muted-foreground">부가세 (10%)</span>
                <span className="font-medium tabular-nums">{fmtKrw(vat)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1">
                <span className="font-medium">합계</span>
                <span className="font-semibold tabular-nums">{fmtKrw(total)}</span>
              </div>
            </div>

            <Field label="메모">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="견적 조건 / 유효기간 등"
                className="resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </Field>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
