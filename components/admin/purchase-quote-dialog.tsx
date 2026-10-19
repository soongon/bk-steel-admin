"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Field } from "@/components/admin/field";
import { BookBadge } from "@/components/admin/book-badge";
import { type CompanyProfile } from "@/lib/company-profile";
import { type Book, type BookView, BOOK_LABEL, BOOKS } from "@/lib/book";
import { fmtKrw } from "@/lib/format";
import { type Attachment, syncAttachments } from "@/lib/attachment";
import { LEAD_NOTE_PLACEHOLDER, LEAD_SOURCES, type LeadSource } from "@/lib/lead-source";
import {
  type PurchaseQuoteLineDraft,
  PURCHASE_QUOTE_CARD_BATCH_BYTES,
  PURCHASE_QUOTE_CARD_KIND,
  PURCHASE_QUOTE_CARD_MAX,
  chunkBySize,
  PURCHASE_QUOTE_DEFAULT_TERMS,
  perKgToPerTon,
  serializePurchaseQuoteLines,
} from "@/lib/purchase-quote";
import { PurchaseQuoteDocument, type PurchaseQuoteDocumentData } from "@/components/admin/purchase-quote-document";
import { PurchaseQuoteCardPicker, revokeStagedCards, type StagedCard } from "@/components/admin/purchase-quote-cards";
import { ReferenceNote } from "@/components/admin/reference-note";
import { createPurchaseQuote, updatePurchaseQuote } from "@/app/[book]/purchase-quotes/actions";

export type PurchaseQuotePartner = {
  id: string;
  name: string;
  representative?: string | null;
  address?: string | null;
  phone?: string | null;
};
export type PurchaseQuoteItemOption = { id: string; name: string };

/** 수정 진입 프리필(book 은 별도 prop, status·doc_no 보존). */
export type EditingPurchaseQuote = {
  id: string;
  doc_no: string;
  quote_date: string;
  valid_until: string | null;
  partner_id: string | null;
  partner_name: string;
  site_name: string | null;
  is_documented: boolean;
  weighing_terms: string | null;
  delivery_terms: string | null;
  payment_terms: string | null;
  notes: string | null;
  lead_source?: LeadSource | null; // 유입경로(0079)
  lead_note?: string | null;
  lines: PurchaseQuoteLineDraft[];
  cards?: Attachment[]; // 판매자 명함(첨부) — 수정에서 빼거나 더할 수 있음
};

export type PurchaseQuoteSources = {
  partners: PurchaseQuotePartner[];
  items: PurchaseQuoteItemOption[]; // 품목명 datalist(선택) — 이름이 정확히 일치하면 item_id 연결
  company?: CompanyProfile | null;
  companies?: Partial<Record<Book, CompanyProfile>>;
};

/** 새로 작성할 때 미리 채울 값(홈페이지 문의 → 매입견적서 등). 수정(editing)이면 쓰지 않는다. */
export type PurchaseQuoteDefaults = {
  partner_name?: string;
  site_name?: string;
  lead_source?: LeadSource | null;
  lead_note?: string;
  /** 폼 위에 참고로 보여 줄 원문(문의 내용) — 저장·출력하지 않는다. */
  reference?: string | null;
};

/** 자주 쓰는 매입 품목 — 품목 마스터에 없어도 바로 고를 수 있게 datalist 상단에 둔다. */
const COMMON_NAMES = ["중고철근", "고철(생철)", "고철(중량)", "고철(경량)", "철근 잔재", "혼합 고철"];

/**
 * 매입견적서 작성/수정 다이얼로그 — 전화 받고 1분 안에 kg 단가를 적어 보내는 흐름.
 * 라인 = 품목명 + 규격·상태 + 원/kg(톤당 환산 자동 표시). 수량·중량·총액은 없다(당일 계근 후 확정).
 */
export function PurchaseQuoteDialog({
  open,
  onOpenChange,
  sources,
  book,
  onSaved,
  editing,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: PurchaseQuoteSources;
  book: BookView;
  onSaved?: (id: string) => void;
  editing?: EditingPurchaseQuote | null;
  /** 새 작성 프리필 — 열릴 때마다 다시 채우므로 렌더마다 새 객체를 만들지 말 것(서버 props 나 useMemo). */
  defaults?: PurchaseQuoteDefaults | null;
}) {
  const { partners, items } = sources;
  const [selectedBook, setSelectedBook] = useState<Book>(book !== "all" ? book : "sl");
  const company = sources.companies?.[selectedBook] ?? sources.company ?? null;
  const [error, setError] = useState<string | null>(null);
  const [showDoc, setShowDoc] = useState(false);
  const [saving, startSaving] = useTransition();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  // 유입경로 — 통화 중 "어디 보고 연락 주셨어요?" 한 번 묻고 1탭. 모르면 비워 둔다(미기록).
  const [leadSource, setLeadSource] = useState<LeadSource | null>(null);
  const [leadNote, setLeadNote] = useState("");
  const leadNotePlaceholder = leadSource ? LEAD_NOTE_PLACEHOLDER[leadSource] : undefined;

  const [partnerInput, setPartnerInput] = useState("");
  const matchedPartner = partners.find((p) => p.name === partnerInput);
  const [siteName, setSiteName] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [undocumented, setUndocumented] = useState(false); // 무자료(부가세 없음)
  // 책별 룰: 법인은 부가세 별도 고정, B계좌는 무자료 고정.
  const effUndocumented = selectedBook === "bk" ? false : selectedBook === "b" ? true : undocumented;

  // 라인 입력
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [lineNote, setLineNote] = useState("");
  const price = Math.round(Number(priceStr) || 0); // 원 단위 정수
  const [lines, setLines] = useState<PurchaseQuoteLineDraft[]>([]);

  const [weighingTerms, setWeighingTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");

  // 판매자 명함 — 기존 사진 중 남길 것(수정) + 새로 고른 축소본. 서버 반영(삭제·업로드)은 저장할 때 한 번에.
  const [keptCards, setKeptCards] = useState<Attachment[]>([]);
  const [stagedCards, setStagedCards] = useState<StagedCard[]>([]);
  const stagedRef = useRef<StagedCard[]>([]);
  useEffect(() => {
    stagedRef.current = stagedCards;
  }, [stagedCards]);
  useEffect(() => () => revokeStagedCards(stagedRef.current), []); // 언마운트 시 미리보기 URL 해제

  const makeDraft = (): PurchaseQuoteLineDraft => ({
    itemId: items.find((i) => i.name === name.trim())?.id ?? null,
    displayName: name.trim(),
    specText: spec.trim() || null,
    pricePerKg: price,
    notes: lineNote.trim() || null,
  });
  // 마지막 입력 중 라인도 자동 포함(매출 견적 폼과 동일).
  const pendingLine = name.trim() && price > 0 ? makeDraft() : null;
  const allLines = pendingLine ? [...lines, pendingLine] : lines;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setShowDoc(false);
    setName("");
    setSpec("");
    setPriceStr("");
    setLineNote("");
    setSelectedBook(book !== "all" ? book : "sl");
    revokeStagedCards(stagedRef.current);
    setStagedCards([]);
    setKeptCards(editing?.cards ?? []);
    if (editing) {
      setPartnerInput(editing.partner_name ?? "");
      setSiteName(editing.site_name ?? "");
      setValidUntil(editing.valid_until ?? "");
      setUndocumented(!editing.is_documented);
      setWeighingTerms(editing.weighing_terms ?? "");
      setDeliveryTerms(editing.delivery_terms ?? "");
      setPaymentTerms(editing.payment_terms ?? "");
      setNotes(editing.notes ?? "");
      setLeadSource(editing.lead_source ?? null);
      setLeadNote(editing.lead_note ?? "");
      setLines(editing.lines);
    } else {
      setPartnerInput(defaults?.partner_name ?? "");
      setSiteName(defaults?.site_name ?? "");
      setValidUntil("");
      setUndocumented(false);
      setWeighingTerms("");
      setDeliveryTerms("");
      setPaymentTerms("");
      setNotes("");
      setLeadSource(defaults?.lead_source ?? null);
      setLeadNote(defaults?.lead_note ?? "");
      setLines([]);
    }
  }, [open, book, editing, defaults]);

  function addLine() {
    if (!name.trim()) { setError("품목명을 입력해주세요."); return; }
    if (price <= 0) { setError("단가(원/kg)를 입력해주세요."); return; }
    setLines((prev) => [...prev, makeDraft()]);
    setName("");
    setSpec("");
    setPriceStr("");
    setLineNote("");
    setError(null);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }
  function addStagedCards(cards: StagedCard[]) {
    const room = Math.max(0, PURCHASE_QUOTE_CARD_MAX - keptCards.length - stagedCards.length);
    revokeStagedCards(cards.slice(room));
    setStagedCards((prev) => [...prev, ...cards.slice(0, room)]);
  }
  function removeStagedCard(key: string) {
    const card = stagedCards.find((c) => c.key === key);
    if (card) URL.revokeObjectURL(card.previewUrl);
    setStagedCards((prev) => prev.filter((c) => c.key !== key));
  }

  /**
   * 명함 반영 — 뺀 기존 사진 삭제 + 새 사진 업로드를 서버 액션 한 번에 보내 서버에서 동시에 처리한다
   * (클라이언트는 서버 액션을 하나씩 차례로 보내므로 장마다 부르면 줄을 선다). 본문 상한을 넘지 않게 3MB 단위로
   * 묶는다 — 줄인 명함은 장당 수백 KB 라 보통 한 번. 실패 건수를 돌려준다(견적은 이미 저장된 뒤).
   */
  async function syncCards(quoteId: string): Promise<number> {
    const removed = (editing?.cards ?? []).filter((c) => !keptCards.some((k) => k.id === c.id));
    if (removed.length === 0 && stagedCards.length === 0) return 0;
    // 새 사진은 남긴 사진 뒤에, 고른 순서대로(동시에 올라가도 순서가 섞이지 않게 sort_order 지정).
    let sortBase = keptCards.reduce((m, c) => Math.max(m, c.sort_order), -1) + 1;
    let failed = 0;
    const batches = chunkBySize(stagedCards, (c) => c.file.size, PURCHASE_QUOTE_CARD_BATCH_BYTES);
    for (const [i, batch] of batches.entries()) {
      const removeNow = i === 0 ? removed : [];
      const fd = new FormData();
      fd.set("entity_type", "purchase_quote");
      fd.set("entity_id", quoteId);
      fd.set("kind", PURCHASE_QUOTE_CARD_KIND);
      fd.set("sort_base", String(sortBase));
      for (const c of removeNow) fd.append("remove_id", c.id);
      for (const c of batch) fd.append("file", c.file);
      const r = await syncAttachments(fd).catch(() => null);
      failed += r?.ok ? r.failed : batch.length + removeNow.length;
      sortBase += batch.length;
    }
    return failed;
  }

  const docData: PurchaseQuoteDocumentData | null =
    allLines.length === 0
      ? null
      : {
          doc_no: editing ? editing.doc_no : `매입견적-${today.replace(/-/g, "")}`,
          quote_date: editing ? editing.quote_date : today,
          valid_until: validUntil || null,
          partner: {
            name: matchedPartner?.name ?? partnerInput,
            representative: matchedPartner?.representative ?? null,
            phone: matchedPartner?.phone ?? null,
            address: matchedPartner?.address ?? null,
          },
          site_name: siteName || null,
          is_documented: !effUndocumented,
          lines: allLines.map((l) => ({ name: l.displayName, spec: l.specText, price_per_kg: l.pricePerKg, note: l.notes })),
          weighing_terms: weighingTerms || null,
          delivery_terms: deliveryTerms || null,
          payment_terms: paymentTerms || null,
          notes: notes || null,
        };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!partnerInput && !siteName) { setError("판매자 또는 현장명 중 하나는 입력해주세요."); return; }
    if (allLines.length === 0) { setError("품목을 1개 이상 추가해주세요."); return; }
    setShowDoc(true);
  }

  function handleSave() {
    const fd = new FormData();
    fd.set("book", selectedBook);
    fd.set("quote_date", editing ? editing.quote_date : today);
    if (validUntil) fd.set("valid_until", validUntil);
    // 수정 시 입력이 원본과 같으면 거래처/미등록 구분 보존(이름 우연일치 승격/강등 방지).
    if (editing && partnerInput === editing.partner_name) {
      if (editing.partner_id) fd.set("partner_id", editing.partner_id);
      else if (partnerInput) fd.set("prospect_name", partnerInput);
    } else if (matchedPartner) {
      fd.set("partner_id", matchedPartner.id);
    } else if (partnerInput) {
      fd.set("prospect_name", partnerInput);
    }
    if (siteName) fd.set("site_name", siteName);
    fd.set("is_documented", effUndocumented ? "false" : "true");
    if (weighingTerms) fd.set("weighing_terms", weighingTerms);
    if (deliveryTerms) fd.set("delivery_terms", deliveryTerms);
    if (paymentTerms) fd.set("payment_terms", paymentTerms);
    if (notes) fd.set("notes", notes);
    if (leadSource) {
      fd.set("lead_source", leadSource);
      if (leadNote.trim()) fd.set("lead_note", leadNote.trim());
    }
    fd.set("lines", serializePurchaseQuoteLines(allLines));
    startSaving(async () => {
      const r = editing ? await updatePurchaseQuote(editing.id, fd) : await createPurchaseQuote(fd);
      if (r.ok) {
        const id = r.id ?? editing?.id ?? "";
        const failedCards = id ? await syncCards(id) : 0;
        toast.success(editing ? "매입견적서 수정됨" : "매입견적서 저장됨");
        if (failedCards > 0) toast.error(`명함 사진 ${failedCards}건을 반영하지 못했습니다 — [수정]에서 다시 해 주세요.`);
        // 미리보기도 닫는다 — 상세(수정)에선 화면이 남아 [수정 저장]을 다시 누르면 명함이 한 번 더 올라갔다.
        setShowDoc(false);
        onOpenChange(false);
        onSaved?.(id);
      } else {
        setError(r.error);
      }
    });
  }

  const toggleCls = (on: boolean) => `rounded-md border px-2.5 py-1 text-xs ${on ? "bg-foreground text-background" : "bg-background"}`;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl print:hidden">
          <DialogHeader>
            <DialogTitle>{editing ? "매입견적서 수정" : "매입견적서 작성"}</DialogTitle>
            <DialogDescription>
              우리가 사는 쪽의 kg당 단가 견적입니다. 총중량·금액은 당일 계근 후 확정되므로 적지 않습니다.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
            {!editing && defaults?.reference ? <ReferenceNote text={defaults.reference} /> : null}
            <Field label="책 *">
              {book === "all" && !editing ? (
                <div className="flex gap-2">
                  {BOOKS.map((b) => (
                    <button type="button" key={b} onClick={() => setSelectedBook(b)} className={`flex-1 ${toggleCls(selectedBook === b)}`}>
                      {BOOK_LABEL[b]}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-8 items-center px-2">
                  <BookBadge book={selectedBook} />
                </div>
              )}
            </Field>

            {/* 유입경로 — label 로 감싸지 않는다(버튼 묶음 + 메모 입력이 한 칸). */}
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">유입경로 — 어디 보고 연락했나 (선택)</span>
              <div className="flex flex-wrap gap-1">
                {LEAD_SOURCES.map((s) => (
                  <button
                    type="button"
                    key={s.value}
                    onClick={() => setLeadSource((cur) => (cur === s.value ? null : s.value))}
                    className={toggleCls(leadSource === s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {leadSource && leadNotePlaceholder ? (
                <Input value={leadNote} onChange={(e) => setLeadNote(e.target.value)} placeholder={leadNotePlaceholder} className="mt-1" />
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="판매자 (거래처, 선택)">
                <Input
                  list="pq-partners"
                  value={partnerInput}
                  onChange={(e) => setPartnerInput(e.target.value)}
                  placeholder="업체명 / 담당자명 입력"
                />
                <datalist id="pq-partners">
                  {partners.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
                {partnerInput && !matchedPartner ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">마스터 미등록 — 판매자명 그대로 표기</p>
                ) : null}
              </Field>
              <Field label="현장명 (물건 위치)">
                <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="예: ○○ 철거 현장" />
              </Field>
            </div>

            {/* 판매자 명함 — <label>(Field)로 감싸지 않는다: 안의 빼기 버튼이 라벨 클릭을 받는다. */}
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">판매자 명함 (선택 · 최대 {PURCHASE_QUOTE_CARD_MAX}장)</span>
              <PurchaseQuoteCardPicker
                kept={keptCards}
                staged={stagedCards}
                onAdd={addStagedCards}
                onRemoveKept={(id) => setKeptCards((prev) => prev.filter((c) => c.id !== id))}
                onRemoveStaged={removeStagedCard}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="유효기간 (선택)">
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </Field>
              <Field label="부가세">
                <div className="flex h-8 items-center gap-1">
                  <button type="button" onClick={() => setUndocumented(false)} disabled={selectedBook === "b"} className={toggleCls(!effUndocumented)}>
                    별도 (자료)
                  </button>
                  <button type="button" onClick={() => setUndocumented(true)} disabled={selectedBook === "bk"} className={toggleCls(effUndocumented)}>
                    무자료
                  </button>
                  {selectedBook === "bk" ? <span className="ml-1 text-[10px] text-muted-foreground">법인은 자료만</span> : null}
                  {selectedBook === "b" ? <span className="ml-1 text-[10px] text-muted-foreground">B계좌는 무자료만</span> : null}
                </div>
              </Field>
            </div>

            {/* 라인 입력 — 품목 + 규격·상태 + 원/kg */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_8rem]">
              <Field label="품목 *">
                <Input list="pq-items" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 중고철근" />
                <datalist id="pq-items">
                  {COMMON_NAMES.map((n) => (
                    <option key={n} value={n} />
                  ))}
                  {items
                    .filter((i) => !COMMON_NAMES.includes(i.name))
                    .map((i) => (
                      <option key={i.id} value={i.name} />
                    ))}
                </datalist>
              </Field>
              <Field label="규격 · 상태">
                <Input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="예: D13~D25 혼합" />
              </Field>
              <Field label="단가 (원/kg) *">
                <Input type="number" step="1" min="0" inputMode="numeric" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} placeholder="0" />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Input value={lineNote} onChange={(e) => setLineNote(e.target.value)} placeholder="라인 비고 (선택, 예: 이물 공제 후)" className="flex-1" />
              {price > 0 ? (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  톤당 <strong className="text-foreground">{fmtKrw(perKgToPerTon(price))}</strong>
                </span>
              ) : null}
            </div>

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
                {lines.map((l, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className="flex-1 truncate font-medium">
                      {l.displayName}
                      {l.specText ? <span className="font-normal text-muted-foreground"> {l.specText}</span> : null}
                    </span>
                    <span className="tabular-nums">{fmtKrw(l.pricePerKg)}/kg</span>
                    <span className="w-28 text-right tabular-nums text-muted-foreground">{fmtKrw(perKgToPerTon(l.pricePerKg))}/톤</span>
                    <button type="button" onClick={() => removeLine(idx)} aria-label="삭제" className="text-muted-foreground hover:text-destructive">
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {/* 조건 — 비우면 기본 문구 */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="계근 조건">
                <Input value={weighingTerms} onChange={(e) => setWeighingTerms(e.target.value)} placeholder={PURCHASE_QUOTE_DEFAULT_TERMS.weighing} />
              </Field>
              <Field label="운반·상하차">
                <Input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} placeholder={PURCHASE_QUOTE_DEFAULT_TERMS.delivery} />
              </Field>
              <Field label="결제조건">
                <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder={PURCHASE_QUOTE_DEFAULT_TERMS.payment} />
              </Field>
            </div>
            <Field label="메모">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="기타 조건 (예: 이물·흙 혼입 시 공제 협의)"
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

      {showDoc && docData ? (
        <Dialog open onOpenChange={(o) => { if (!o) setShowDoc(false); }}>
          <DialogContent className="!max-w-[920px] max-h-[90vh] overflow-y-auto">
            <DialogHeader className="print:hidden">
              <DialogTitle>매입견적서 미리보기</DialogTitle>
            </DialogHeader>
            <div className="bg-zinc-100 p-3 print:bg-white print:p-0 dark:bg-zinc-900">
              <div className="mx-auto max-w-[800px] rounded bg-white p-6 text-zinc-900 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
                <PurchaseQuoteDocument data={docData} company={company} />
              </div>
            </div>
            <DialogFooter className="print:hidden">
              <Button variant="outline" onClick={() => setShowDoc(false)}>
                수정
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                <PrinterIcon className="size-4" /> 프린트
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <SaveIcon className="size-4" /> {saving ? "저장 중..." : editing ? "수정 저장" : "저장"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** 트리거 버튼 + 다이얼로그. 저장 후 상세로 이동(바로 문자 전송·인쇄할 수 있게). */
export function PurchaseQuoteButton({
  sources,
  book,
  label = "매입견적서 작성",
}: {
  sources: PurchaseQuoteSources;
  book: BookView;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <FileTextIcon className="size-4" />
        {label}
      </Button>
      <PurchaseQuoteDialog
        open={open}
        onOpenChange={setOpen}
        sources={sources}
        book={book}
        onSaved={(id) => (id ? router.push(`/${book}/purchase-quotes/${id}`) : router.refresh())}
      />
    </>
  );
}
