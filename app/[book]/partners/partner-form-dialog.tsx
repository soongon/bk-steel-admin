"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormattedInput, type NumberFormat } from "@/components/admin/formatted-input";
import { Button } from "@/components/ui/button";
import {
  PartnerDocPicker,
  imageFilesOf,
  revokeStagedDocs,
  stagePartnerDocFiles,
  type StagedPartnerDoc,
} from "@/components/admin/partner-docs";
import { formatBusinessNo, formatPhone } from "@/lib/format";
import { chunkBySize } from "@/lib/purchase-quote";
import {
  BIZ_DOC_TYPE_LABEL,
  BIZ_PARTY_ROLE_LABEL,
  BIZ_TYPE_ITEM_MAX,
  DOC_FILL_FIELDS,
  PARTNER_DOC_BATCH_BYTES,
  PARTNER_DOC_FIELD_LABEL,
  PARTNER_DOC_MAX,
  bizNoConflicts,
  canAutoRegister,
  fillEmpty,
  partnerFieldsOf,
  type BizParty,
  type PartnerDocField,
  type PartnerDocFields,
  type PartnerDocView,
} from "@/lib/biz-doc";
import { createPartner, registerPartnerFromDoc, updatePartner, type PartnerActionResult } from "./actions";
import { listPartnerDocsAction, readPartnerDoc, syncPartnerDocs } from "./doc-actions";

export type PartnerRow = {
  id: string;
  code: string;
  name: string;
  business_no: string | null;
  representative: string | null;
  phone: string | null;
  email: string | null;
  email2: string | null;
  address: string | null;
  business_type: string | null; // 업태
  business_item: string | null; // 종목
  notes: string | null;
  is_active: boolean;
  /** 사업자 이미지 수 — 목록 표시용(0088) */
  doc_count?: number;
};

/** 명함·발주 레이더에서 거래처로 이관 시 prefill 시드 데이터 (출처 id 둘 중 하나) */
export type PartnerPrefill = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  representative?: string | null;
  business_no?: string | null;
  business_type?: string | null;
  business_item?: string | null;
  from_card_id?: string;
  /** 발주 레이더 행 — 저장 후 그 행(낙찰이면 같은 사업자번호 계정)에 거래처 연결(★) */
  from_radar_id?: string;
  /** 홈페이지 문의 id — 제목·안내 문구만 바뀐다(연결 저장 없음: 문의는 전화번호로 거래처를 찾는다). */
  from_inquiry_id?: string;
};

/** 폼 칸 값(화면 표기 그대로) — 이미지로 칸을 채울 때 지금 입력값을 읽어 폼을 다시 그린다. */
type FormValues = {
  code: string;
  name: string;
  representative: string;
  business_no: string;
  phone: string;
  email: string;
  email2: string;
  business_type: string;
  business_item: string;
  address: string;
  notes: string;
  is_active: boolean;
};
const TEXT_KEYS = [
  "code",
  "name",
  "representative",
  "business_no",
  "phone",
  "email",
  "email2",
  "business_type",
  "business_item",
  "address",
  "notes",
] as const;

function initialValues(row: PartnerRow | null, prefill: PartnerPrefill | null | undefined): FormValues {
  const base = row ?? prefill ?? null;
  return {
    code: row?.code ?? "",
    name: base?.name ?? "",
    representative: base?.representative ?? "",
    business_no: formatBusinessNo(base?.business_no),
    phone: formatPhone(base?.phone),
    email: base?.email ?? "",
    email2: row?.email2 ?? "",
    business_type: base?.business_type ?? "",
    business_item: base?.business_item ?? "",
    address: base?.address ?? "",
    notes: base?.notes ?? "",
    is_active: row ? row.is_active : true,
  };
}

function readForm(form: HTMLFormElement | null, fallback: FormValues): FormValues {
  return form ? valuesOf(new FormData(form), fallback) : fallback;
}

function valuesOf(fd: FormData, fallback: FormValues): FormValues {
  const out = { ...fallback, is_active: fd.get("is_active") === "on" };
  for (const k of TEXT_KEYS) {
    const v = fd.get(k);
    out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

function toFormData(v: FormValues): FormData {
  const fd = new FormData();
  for (const k of TEXT_KEYS) fd.set(k, v[k]);
  fd.set("is_active", v.is_active ? "true" : "false");
  return fd;
}

const isBlank = (s: string) => s.replace(/[-\s]/g, "") === "";
/** 글을 붙여 넣는 칸 — 여기에 글이 든 클립보드를 붙이면 그림이 같이 실려 와도 글로 둔다. */
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "tel", "url", "number", "password"]);
const isTextEntry = (t: EventTarget | null) =>
  t instanceof HTMLTextAreaElement ||
  (t instanceof HTMLElement && t.isContentEditable) ||
  (t instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(t.type));

/**
 * 엑셀·워드·한글에서 복사한 글인가 — 글과 서식(html·rtf)이 같이 실려 오고, 글이 주소·파일 이름 한 줄이 아니다.
 * 이런 복사본에는 그 칸 모양의 그림도 실려 오므로 그림으로 받으면 안 된다. 화면 캡처·'이미지 복사'는 글이 없고,
 * 파인더에서 복사한 파일은 글이 파일 이름뿐이라 그림으로 받는다.
 */
function isOfficeText(cd: DataTransfer): boolean {
  const text = cd.getData("text/plain").trim();
  if (!text) return false;
  const types = Array.from(cd.types);
  if (!types.includes("text/html") && !types.includes("text/rtf")) return false;
  return !/^(https?:\/\/\S+|[^\n\t]+\.(png|jpe?g|webp|gif|heic|heif|bmp|tiff?))$/i.test(text);
}

/**
 * 같은 이름 후보에서 고를 때 '사람이 적은 값' — 패널이 뜬 뒤 폼에서 고친 칸은 지금 값, 그대로인 칸은 이미지를 합치기 전에
 * 적어 둔 값(없으면 빈 칸). 이미지에서 읽은 값을 사람이 적은 값으로 치면 기존 거래처의 이메일·연락처를 덮어쓰라고 권하게 된다.
 */
function typedAfterEdit(now: FormValues, sent: FormValues, typed: FormValues): FormValues {
  const out = { ...typed };
  for (const k of TEXT_KEYS) if (now[k] !== sent[k]) out[k] = now[k];
  return out;
}
const fieldLabels = (fs: PartnerDocField[]) => fs.map((f) => PARTNER_DOC_FIELD_LABEL[f]).join("·");

/** 새 거래처 — 사업자 칸(상호·번호·대표자·주소·업태·종목)은 이미지 값으로, 연락처·이메일은 비어 있을 때만. 메모 등은 그대로. */
function withDocFields(now: FormValues, f: PartnerDocFields): FormValues {
  return {
    ...now,
    name: f.name ?? now.name,
    business_no: f.business_no ? formatBusinessNo(f.business_no) : now.business_no,
    representative: f.representative ?? now.representative,
    address: f.address ?? now.address,
    business_type: f.business_type ?? now.business_type,
    business_item: f.business_item ?? now.business_item,
    email: now.email.trim() || f.email || "",
    phone: now.phone.trim() || formatPhone(f.phone),
  };
}

function actionError(e: unknown, what: string): string {
  return unstable_isUnrecognizedActionError(e)
    ? "새 버전이 배포됐습니다 — 새로고침한 뒤 다시 해 주세요."
    : `${what} 요청이 실패했습니다 — 연결을 확인하고 다시 해 주세요.`;
}

/** 사람이 골라야 할 때 — 서류의 두 사업자 중 어느 쪽인지 / 같은 이름 거래처에 채울지 새로 만들지 */
type Choice =
  | { type: "party"; doc: StagedPartnerDoc; parties: BizParty[] }
  | {
      type: "name";
      doc: StagedPartnerDoc;
      candidates: Array<{ id: string; code: string; name: string }>;
      /** 보낸 칸 값(이미지 값 포함)과 그 전에 사람이 적어 둔 값 */
      sent: FormValues;
      typed: FormValues;
    };
type NameChoice = Extract<Choice, { type: "name" }>;

export function PartnerFormDialog({
  open,
  onOpenChange,
  editing,
  prefill,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PartnerRow | null;
  prefill?: PartnerPrefill | null;
  /** 저장 성공 뒤 — 거래처 화면 밖에서 열었을 때 그 화면을 새로 그리는 데 쓴다. */
  onSaved?: () => void;
}) {
  // 열 때마다 본문을 새로 그린다(이전 입력·이미지·인식 상태를 버림). 닫히는 애니메이션 동안에는 그대로 둔다.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((s) => s + 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <PartnerFormBody
          key={session}
          active={open}
          editing={editing}
          prefill={prefill ?? null}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function PartnerFormBody({
  active,
  editing,
  prefill,
  onClose,
  onSaved,
}: {
  /** 다이얼로그가 열려 있는가 — 닫은 뒤 끝난 인식 결과로 등록하지 않게 */
  active: boolean;
  editing: PartnerRow | null;
  prefill: PartnerPrefill | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  // 이미지로 자동 등록(또는 기존 거래처에 채움)하면 이 다이얼로그는 그 거래처의 수정 화면이 된다 — 더 적을 내용은 거기서.
  const [saved, setSaved] = useState<PartnerRow | null>(null);
  const current = editing ?? saved;
  const isPrefill = !current && !!prefill;
  const autoRegister = !current && !prefill; // 빈 신규 등록 — 이미지를 읽으면 묻지 않고 바로 등록

  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<FormValues>(() => initialValues(editing, prefill));
  const [formKey, setFormKey] = useState(0);
  const redraw = (v: FormValues) => {
    setValues(v);
    setFormKey((k) => k + 1);
  };
  const formNow = () => readForm(formRef.current, values);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 사업자 이미지 — 저장된 것(수정) + 새로 고른 축소본. 서버 반영은 저장할 때 한 번에(자동 등록은 등록과 함께).
  const editingId = editing?.id ?? null;
  const [kept, setKept] = useState<PartnerDocView[]>([]);
  const [docsLoading, setDocsLoading] = useState(!!editingId);
  const [removed, setRemoved] = useState<string[]>([]);
  const [staged, setStaged] = useState<StagedPartnerDoc[]>([]);
  const stagedRef = useRef<StagedPartnerDoc[]>([]); // 인식·등록은 await 뒤에 이어지므로 최신 목록은 ref 로
  const setStagedDocs = (next: StagedPartnerDoc[]) => {
    stagedRef.current = next;
    setStaged(next);
  };
  useEffect(() => () => revokeStagedDocs(stagedRef.current), []); // 닫을 때 미리보기 URL 해제
  const [step, setStep] = useState<null | "shrink" | "read" | "register" | "upload">(null);
  const [readingKey, setReadingKey] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const busy = step !== null || pending;
  // 인식(수 초)이 끝나기 전에 닫거나 다시 열었으면 그 결과로 등록·채우기를 하지 않는다.
  const aliveRef = useRef(active);
  useEffect(() => {
    aliveRef.current = active;
  }, [active]);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );
  // 이미지 값을 폼에 채운 적이 있으면 그때 채운 값(sent)과 그 전에 사람이 적어 둔 값(typed). 다음 이미지 때
  // 앞 이미지 값을 사람이 적은 값으로 치지 않는다(다른 회사 서류면 그 값이 섞여 등록된다).
  const ocrBaseRef = useRef<{ sent: FormValues; typed: FormValues } | null>(null);
  const typedNow = (now: FormValues) =>
    ocrBaseRef.current ? typedAfterEdit(now, ocrBaseRef.current.sent, ocrBaseRef.current.typed) : now;
  // 이미지 흐름(줄이기 → 인식 → 채우기·등록)은 한 번에 하나 — 겹치면 같은 이미지로 두 번 등록되거나 진행 표시가 먼저 꺼진다.
  const flowRef = useRef(false);
  async function runFlow(fn: () => Promise<void>) {
    if (flowRef.current) return;
    flowRef.current = true;
    try {
      await fn();
    } finally {
      flowRef.current = false;
    }
  }

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    listPartnerDocsAction(editingId)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setKept(r.docs);
        else toast.error(r.error);
      })
      .catch(() => {
        if (!cancelled) toast.error("사업자 이미지를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setDocsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  /** 이미지 추가 → (첫 장) AI 인식 → 칸 채우기 또는 자동 등록 */
  function addFiles(files: File[]) {
    if (files.length === 0) return;
    if (pending) {
      toast.info("저장하는 중입니다 — 끝난 뒤 다시 올려 주세요.");
      return;
    }
    if (flowRef.current) {
      toast.info("앞의 이미지를 처리하는 중입니다 — 끝난 뒤 다시 올려 주세요.");
      return;
    }
    if (choice) {
      toast.info("먼저 위의 선택을 마쳐 주세요.");
      return;
    }
    if (docsLoading) {
      toast.info("저장된 이미지를 불러오는 중입니다 — 잠시 뒤 다시 올려 주세요.");
      return;
    }
    void runFlow(async () => {
      const room = PARTNER_DOC_MAX - kept.length - stagedRef.current.length;
      if (room <= 0) {
        toast.error(`사업자 이미지는 거래처당 최대 ${PARTNER_DOC_MAX}장입니다.`);
        return;
      }
      if (files.length > room) toast.error(`사업자 이미지는 최대 ${PARTNER_DOC_MAX}장 — ${room}장만 추가합니다.`);
      setError(null);
      setStep("shrink");
      let docs: StagedPartnerDoc[] = [];
      try {
        docs = await stagePartnerDocFiles(files.slice(0, room));
      } finally {
        setStep(null);
      }
      if (!aliveRef.current) {
        revokeStagedDocs(docs); // 줄이는 사이에 닫았다 — 인식(유료)도 하지 않는다
        return;
      }
      if (docs.length === 0) return;
      setStagedDocs([...stagedRef.current, ...docs]);
      // AI 인식은 첫 장만. 수정 화면은 채울 빈 칸이 있을 때만(다 적힌 거래처에 이미지만 붙이는 경우가 흔하다).
      if (current && !DOC_FILL_FIELDS.some((k) => isBlank(formNow()[k]))) return;
      await recognize(docs[0]);
    });
  }

  async function recognize(doc: StagedPartnerDoc) {
    setStep("read");
    setReadingKey(doc.key);
    setNotice(null);
    const fd = new FormData();
    fd.set("file", doc.file);
    let r: Awaited<ReturnType<typeof readPartnerDoc>>;
    try {
      r = await readPartnerDoc(fd);
    } catch (e) {
      toast.error(actionError(e, "이미지 인식"));
      return;
    } finally {
      setStep(null);
      setReadingKey(null);
    }
    if (!aliveRef.current) return;
    if (!r.ok) {
      if (r.code === "not_configured") {
        setNotice("이미지 자동 인식이 아직 설정되지 않아 칸은 직접 채워 주세요 — 이미지는 저장할 때 함께 올라갑니다.");
      } else toast.error(r.error);
      return;
    }
    const withKind = { ...doc, kind: r.kind };
    setStagedDocs(stagedRef.current.map((d) => (d.key === doc.key ? withKind : d)));
    const what = BIZ_DOC_TYPE_LABEL[r.docType];
    switch (r.pick.kind) {
      case "none":
        toast.error(`${what}에서 사업자 정보를 찾지 못했습니다${r.note ? ` — ${r.note}` : ""}. 칸은 직접 채워 주세요.`);
        return;
      case "own_only":
        toast.error("이미지의 사업자가 우리 회사뿐입니다 — 거래처 쪽이 보이는 서류인지 확인해 주세요.");
        return;
      case "choose":
        setChoice({ type: "party", doc: withKind, parties: r.pick.parties });
        return;
      case "picked":
        await applyParty(withKind, r.pick.party);
        return;
    }
  }

  async function applyParty(doc: StagedPartnerDoc, party: BizParty) {
    const fields = partnerFieldsOf(party);
    const now = formNow();
    if (current) {
      // 수정 — 빈 칸만 채운다. 다른 회사 서류(사업자번호가 다름)면 손대지 않는다.
      if (bizNoConflicts(now.business_no, fields.business_no)) {
        toast.warning(`이미지의 사업자번호(${formatBusinessNo(fields.business_no)})가 이 거래처와 다릅니다 — 칸은 그대로 두었습니다.`);
        return;
      }
      const { patch, filled } = fillEmpty(now, fields);
      if (filled.length === 0) {
        toast.info("채울 빈 칸이 없습니다 — 이미지는 [수정]을 누르면 저장됩니다.");
        return;
      }
      const next = { ...now };
      for (const k of filled) {
        next[k] = k === "business_no" ? formatBusinessNo(patch[k]) : k === "phone" ? formatPhone(patch[k]) : (patch[k] ?? "");
      }
      redraw(next);
      setNotice(`이미지에서 ${fieldLabels(filled)}을(를) 채웠습니다 — 확인하고 [수정]을 누르면 저장됩니다.`);
      return;
    }
    const typed = typedNow(now);
    const merged = withDocFields(typed, fields);
    if (autoRegister && canAutoRegister(fields)) {
      await register(doc, merged, "auto", typed);
      return;
    }
    ocrBaseRef.current = { sent: merged, typed };
    redraw(merged);
    setNotice(
      isPrefill
        ? "이미지에서 읽은 사업자 정보로 칸을 채웠습니다 — 확인하고 [추가]를 누르면 이미지와 함께 저장됩니다."
        : !fields.name
          ? "상호를 읽지 못했습니다 — 거래처명을 적고 [추가]를 누르면 이미지와 함께 저장됩니다."
          : `사업자번호를 ${fields.business_no ? "확인해 주세요(검증번호가 맞지 않음)" : "읽지 못했습니다"} — 확인하고 [추가]를 누르면 이미지와 함께 저장됩니다.`,
    );
  }

  /**
   * 자동 등록 — 이 이미지(+ 함께 고른 새 이미지, 3MB 안)와 칸 값 v 를 보내 등록(또는 기존 거래처에 채움)한다.
   * typed = 이미지 값을 합치기 전 사람이 적어 둔 값 — 기존 거래처에 들어가지 못한 것은 폼에 남겨 [수정]으로 저장하게 한다.
   */
  async function register(
    doc: StagedPartnerDoc,
    v: FormValues,
    mode: "auto" | "new" | "fill",
    typed: FormValues,
    targetId?: string,
    /** 같은 이름 후보에서 고른 경우 — 실패하면 그 선택지를 다시 보여 준다([추가]는 같은 이름 거래처를 하나 더 만든다) */
    restore?: NameChoice,
  ) {
    if (!aliveRef.current) return;
    setChoice(null);
    setError(null);
    setStep("register");
    const batch = [stagedRef.current.find((d) => d.key === doc.key) ?? doc];
    let size = batch[0].file.size;
    for (const d of stagedRef.current) {
      if (d.key === doc.key || size + d.file.size > PARTNER_DOC_BATCH_BYTES) continue;
      batch.push(d);
      size += d.file.size;
    }
    const fd = toFormData(v);
    fd.set("mode", mode);
    if (targetId) fd.set("target_id", targetId);
    for (const d of batch) {
      fd.append("file", d.file);
      fd.append("kind", d.kind);
    }
    let r: Awaited<ReturnType<typeof registerPartnerFromDoc>>;
    try {
      r = await registerPartnerFromDoc(fd);
    } catch (e) {
      // 응답만 잃었을 수 있다(서버는 저장했을 수도) — 같은 선택을 다시 누르게 하지 않는다.
      ocrBaseRef.current = { sent: v, typed };
      redraw(v);
      setError(
        restore
          ? `${actionError(e, "등록")} 목록을 새로고침해 저장됐는지 확인해 주세요.`
          : `${actionError(e, "등록")} 칸은 채워 두었습니다 — 확인하고 [추가]를 눌러도 됩니다.`,
      );
      return;
    } finally {
      setStep(null);
    }
    if (!r.ok) {
      ocrBaseRef.current = { sent: v, typed };
      redraw(v);
      if (restore && !r.saved) setChoice(restore);
      setError(r.error);
      if (r.saved) onSaved?.();
      return;
    }
    if (r.status === "name_match") {
      ocrBaseRef.current = { sent: v, typed };
      redraw(v); // 무엇으로 채우거나 만들지 폼에 보여 준다(고르기 전에 고쳐도 된다 — 고를 때의 폼 값으로 보낸다)
      setChoice({ type: "name", doc, candidates: r.candidates, sent: v, typed });
      return;
    }
    const sent = new Set(batch.map((d) => d.key));
    revokeStagedDocs(stagedRef.current.filter((d) => sent.has(d.key)));
    setStagedDocs(stagedRef.current.filter((d) => !sent.has(d.key)));
    setSaved(r.partner);
    setKept(r.docs);
    setRemoved([]);
    // 기존 거래처에 이미 값이 있어 들어가지 못한, 사람이 적어 둔 칸은 지우지 않고 폼에 남긴다 — 무엇을 바꾸게 되는지
    // 안내에 기존 값을 보여 주고, 메모는 기존 메모 뒤에 덧붙인다([수정]을 눌러야 저장).
    ocrBaseRef.current = null;
    const next = initialValues(r.partner, null);
    const unsaved: string[] = [];
    for (const [k, label] of [["phone", "연락처"], ["email", "이메일"], ["email2", "이메일 2"]] as const) {
      const t = typed[k].trim();
      const was = next[k].trim();
      const same = k === "phone" ? t.replace(/\D/g, "") === was.replace(/\D/g, "") : t.toLowerCase() === was.toLowerCase();
      if (!t || same) continue;
      unsaved.push(was ? `${label}(기존 ${was} → ${t})` : label);
      next[k] = t;
    }
    const memo = typed.notes.trim();
    const memoWas = next.notes.trim();
    if (memo && !memoWas.includes(memo)) {
      unsaved.push(memoWas ? "메모(기존 메모 뒤에 덧붙임)" : "메모");
      next.notes = memoWas ? `${memoWas} / ${memo}` : memo;
    }
    redraw(next);
    const who = `${r.partner.name} (${r.partner.code})`;
    if (r.status === "created") toast.success(`거래처를 등록했습니다: ${who}`);
    else
      toast.success(
        `이미 있는 거래처 ${who}에 ${r.filled.length > 0 ? `${fieldLabels(r.filled)}을(를) 채우고 ` : ""}이미지를 붙였습니다.`,
      );
    if (r.warning) toast.warning(r.warning);
    // 한 번에 못 실은(3MB 넘는) 나머지 새 이미지도 바로 올린다 — 닫아도 사라지지 않게.
    let docFailed = r.docFailed;
    let retry = 0;
    const rest = stagedRef.current;
    if (rest.length > 0) {
      setStep("upload");
      const up = await uploadDocs(r.partner.id, rest, []);
      const listed = await listPartnerDocsAction(r.partner.id).catch(() => null);
      // 요청째 실패한 묶음은 그대로 두어 [수정]이 다시 올리게 한다 — 단 응답만 잃고 실제로는 다 올라갔으면(목록이 보낸 만큼
      // 늘었으면) 다시 올리지 않는다(같은 이미지가 두 번 붙는다).
      const allIn = !!listed?.ok && listed.docs.length >= r.docs.length + rest.length;
      const retryDocs = allIn ? [] : up.retry;
      const done = rest.filter((d) => !retryDocs.includes(d));
      revokeStagedDocs(done);
      setStagedDocs(stagedRef.current.filter((d) => !done.includes(d)));
      if (!allIn) docFailed += up.failed - up.retry.length;
      retry = retryDocs.length;
      if (listed?.ok) setKept(listed.docs);
      setStep(null);
    }
    if (docFailed > 0) toast.warning(`이미지 ${docFailed}장을 올리지 못했습니다 — 다시 올려 주세요.`);
    const pendingSave = unsaved.length > 0 || retry > 0;
    setNotice(
      [
        r.status === "created" ? "등록했습니다." : "이미 등록된 거래처라 새로 만들지 않았습니다.",
        unsaved.length > 0 ? `적어 둔 ${unsaved.join(", ")}은(는) 아직 저장 전입니다.` : "",
        retry > 0 ? `이미지 ${retry}장은 아직 못 올렸습니다.` : "",
        pendingSave
          ? "확인하고 [수정]을 누르세요."
          : r.status === "created"
            ? "연락처·메모처럼 더 적을 내용이 있으면 고친 뒤 [수정]을 누르세요 — 없으면 닫으면 됩니다."
            : "더 적을 내용이 있으면 고친 뒤 [수정]을 누르세요.",
      ]
        .filter(Boolean)
        .join(" "),
    );
    onSaved?.();
  }

  function removeStaged(key: string) {
    revokeStagedDocs(stagedRef.current.filter((d) => d.key === key));
    setStagedDocs(stagedRef.current.filter((d) => d.key !== key));
    if (choice?.doc.key === key) setChoice(null);
  }
  function removeKept(id: string) {
    setKept((prev) => prev.filter((d) => d.id !== id));
    setRemoved((prev) => [...prev, id]);
  }

  /**
   * 사업자 이미지 반영 — 뺀 것 삭제 + 새 것 업로드, 3MB 단위로 묶어 보낸다.
   * failed = 반영 못 한 장 수, retry = 요청째 실패한 묶음의 새 이미지(다시 올릴 수 있게 돌려준다).
   */
  async function uploadDocs(
    partnerId: string | null,
    adds: StagedPartnerDoc[],
    removes: string[],
  ): Promise<{ failed: number; retry: StagedPartnerDoc[] }> {
    if (adds.length === 0 && removes.length === 0) return { failed: 0, retry: [] };
    if (!partnerId) return { failed: adds.length + removes.length, retry: adds };
    let failed = 0;
    const retry: StagedPartnerDoc[] = [];
    for (const [i, batch] of chunkBySize(adds, (d) => d.file.size, PARTNER_DOC_BATCH_BYTES).entries()) {
      const removeNow = i === 0 ? removes : [];
      const fd = new FormData();
      fd.set("partner_id", partnerId);
      for (const id of removeNow) fd.append("remove_id", id);
      for (const d of batch) {
        fd.append("file", d.file);
        fd.append("kind", d.kind);
      }
      const r = await syncPartnerDocs(fd).catch(() => null);
      if (r?.ok) failed += r.failed;
      else {
        failed += batch.length + removeNow.length;
        retry.push(...batch);
      }
    }
    return { failed, retry };
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    // React 는 폼 액션이 끝나면 칸을 처음 값으로 되돌린다 — 저장이 안 됐으면 적은 값을 다시 채워 둔다.
    const submitted = valuesOf(formData, values);
    startTransition(async () => {
      let result: PartnerActionResult;
      try {
        result = current ? await updatePartner(current.id, formData) : await createPartner(formData);
      } catch (e) {
        redraw(submitted);
        setError(actionError(e, "저장"));
        return;
      }
      if (!result.ok) {
        redraw(submitted);
        setError(result.error);
        return;
      }
      const { failed: docFailed } = await uploadDocs(current?.id ?? result.partnerId ?? null, stagedRef.current, removed);
      toast.success(result.message ?? (current ? "거래처가 수정되었습니다" : "거래처가 추가되었습니다"));
      if (result.warning) toast.warning(result.warning);
      if (docFailed > 0) toast.warning(`사업자 이미지 ${docFailed}장을 반영하지 못했습니다 — 수정에서 다시 해 주세요.`);
      onClose();
      onSaved?.();
    });
  }

  // 열려 있는 동안 화면 어디에 붙여 넣거나 끌어다 놓아도 이미지를 받는다. 놓친 파일 끌어놓기는 브라우저가 그 파일을
  // 열어 화면(입력·인식 결과)을 날리므로 늘 막는다(바쁠 때·이미지 칸 밖·상한일 때 포함).
  const addFilesRef = useRef(addFiles);
  useEffect(() => {
    addFilesRef.current = addFiles;
  });
  useEffect(() => {
    if (!active) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = imageFilesOf(e.dataTransfer?.files);
      if (files.length > 0) addFilesRef.current(files);
      else toast.error("사진 파일(JPEG·PNG·WebP)만 올릴 수 있습니다.");
    };
    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      const files = imageFilesOf(cd?.files);
      if (!cd || files.length === 0) return;
      if (isOfficeText(cd)) {
        // 글로 붙인다(입력칸이면 그대로 들어간다). 입력칸 밖이면 어디에 붙일지 알려 준다.
        if (!isTextEntry(e.target)) toast.info("복사한 글은 입력칸을 누른 뒤 붙여 넣어 주세요.");
        return;
      }
      e.preventDefault(); // 파일 이름 같은 글이 입력칸에 들어가지 않게
      addFilesRef.current(files);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
    };
  }, [active]);

  // 인식·등록 중에는 칸을 잠근다 — 보낸 값과 화면이 어긋나지 않게(읽기 전용이라 값은 그대로 읽힌다).
  const locked = step === "read" || step === "register" || step === "upload";
  const docCount = kept.length + staged.length;
  const stepLabel =
    step === "shrink"
      ? "사진 줄이는 중…"
      : step === "read"
        ? "이미지 읽는 중… (5~15초)"
        : step === "register"
          ? "등록하는 중…"
          : step === "upload"
            ? "남은 이미지 올리는 중…"
            : null;

  return (
    <div
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>
          {current
            ? "거래처 수정"
            : isPrefill
              ? prefill?.from_radar_id
                ? "신규 거래처 등록 (발주 레이더)"
                : prefill?.from_inquiry_id
                  ? "신규 거래처 등록 (홈페이지 문의)"
                  : "신규 거래처 등록 (명함 기반)"
              : "신규 거래처 등록"}
        </DialogTitle>
        <DialogDescription>
          {isPrefill
            ? prefill?.from_radar_id
              ? "레이더 기록으로 채워진 폼입니다. 저장하면 레이더 행에 거래처로 연결됩니다(★). 같은 이름·사업자번호의 거래처가 이미 있으면 새로 만들지 않고 그 거래처에 연결합니다."
              : prefill?.from_inquiry_id
                ? "문의에 적힌 이름·연락처로 채워진 폼입니다. 상호·대표자는 통화로 확인해 고쳐 주세요. 저장하면 문의 화면에 거래처로 표시됩니다(같은 전화번호)."
                : "명함 정보로 채워진 폼입니다. 검토 후 저장하면 명함에 자동 매핑됩니다."
            : autoRegister
              ? "계산서·사업자등록증 사진을 올리면 읽어서 바로 등록합니다. 직접 입력해도 됩니다."
              : "공유 마스터 — 매출·매입에서 거래처명 정합성의 기준이 됩니다."}
        </DialogDescription>
      </DialogHeader>

      <section aria-label="사업자 이미지" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            사업자 이미지{docCount > 0 ? ` ${docCount}/${PARTNER_DOC_MAX}` : ""}
          </span>
          {stepLabel ? <span className="text-xs text-sky-700 dark:text-sky-400">{stepLabel}</span> : null}
        </div>
        <PartnerDocPicker
          kept={kept}
          staged={staged}
          loading={docsLoading}
          readingKey={readingKey}
          disabled={busy || docsLoading}
          canAdd={docCount < PARTNER_DOC_MAX}
          addTitle={autoRegister && docCount === 0 ? "사진으로 자동 등록" : "이미지 추가"}
          addHint={
            autoRegister && docCount === 0
              ? "계산서·사업자등록증 · 촬영·선택·끌어놓기·붙여넣기"
              : current
                ? "빈 칸이 있으면 읽어서 채움"
                : "올리면 사업자 칸을 채움"
          }
          onFiles={addFiles}
          onRemoveKept={removeKept}
          onRemoveStaged={removeStaged}
        />

        {choice?.type === "party" ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p>서류의 두 사업자 중 어느 쪽이 거래처인가요?</p>
            {choice.parties.map((p) => (
              <Button
                key={p.role}
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                className="h-auto justify-start whitespace-normal py-1.5 text-left"
                onClick={() => {
                  const doc = choice.doc;
                  setChoice(null);
                  void runFlow(() => applyParty(doc, p));
                }}
              >
                <span className="text-muted-foreground">{BIZ_PARTY_ROLE_LABEL[p.role]}</span>
                <span className="font-medium">{p.name ?? "(상호 못 읽음)"}</span>
                {p.business_no ? <span className="text-xs text-muted-foreground">{formatBusinessNo(p.business_no)}</span> : null}
              </Button>
            ))}
            <Button type="button" variant="ghost" size="sm" className="self-end" disabled={busy} onClick={() => setChoice(null)}>
              닫기
            </Button>
          </div>
        ) : choice?.type === "name" ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p>
              같은 이름의 거래처가 이미 있습니다(사업자번호 없음). 아래 칸의 내용으로 그 거래처의 빈 칸을 채울까요, 새로
              등록할까요?
            </p>
            {choice.candidates.map((c) => (
              <Button
                key={c.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                className="h-auto justify-start whitespace-normal py-1.5 text-left"
                onClick={() => {
                  const f = formNow();
                  void runFlow(() => register(choice.doc, f, "fill", typedAfterEdit(f, choice.sent, choice.typed), c.id, choice));
                }}
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.code} · 여기에 채우기</span>
              </Button>
            ))}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setChoice(null)}>
                직접 확인
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const f = formNow();
                  void runFlow(() => register(choice.doc, f, "new", typedAfterEdit(f, choice.sent, choice.typed), undefined, choice));
                }}
              >
                새 거래처로 등록
              </Button>
            </div>
          </div>
        ) : null}

        {notice ? (
          <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
            {notice}
          </p>
        ) : null}
      </section>

      <form
        ref={formRef}
        action={handleSubmit}
        className={`flex flex-col gap-3 transition-opacity ${locked ? "opacity-60" : ""}`}
        aria-busy={locked}
        // 이미지로 칸을 채우면(또는 자동 등록 뒤) 새 값으로 다시 그린다
        key={`${current?.id ?? "new"}-${formKey}`}
      >
        {isPrefill && prefill?.from_card_id ? <input type="hidden" name="from_card" value={prefill.from_card_id} /> : null}
        {isPrefill && prefill?.from_radar_id ? <input type="hidden" name="from_radar" value={prefill.from_radar_id} /> : null}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={current ? "코드 *" : "코드"}
            name="code"
            defaultValue={values.code}
            placeholder={current ? "예: P-100" : "비워두면 자동 (P-NNN)"}
            required={!!current}
            uppercase readOnly={locked}
          />
          <Field label="거래처명 *" name="name" defaultValue={values.name} placeholder="(주)엠에스스틸" required readOnly={locked} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="대표자" name="representative" defaultValue={values.representative} readOnly={locked} />
          <Field label="사업자번호" name="business_no" defaultValue={values.business_no} placeholder="000-00-00000" format="bizNo" readOnly={locked} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="연락처" name="phone" defaultValue={values.phone} placeholder="010-0000-0000" format="phone" readOnly={locked} />
          <Field label="이메일 (세금계산서 수신)" name="email" type="email" defaultValue={values.email} placeholder="contact@partner.com" readOnly={locked} />
        </div>
        <Field label="이메일 2 (선택 · 계산서 추가 수신)" name="email2" type="email" defaultValue={values.email2} placeholder="담당자2@partner.com" readOnly={locked} />
        {/* 업태·종목은 여러 개를 쉼표로 잇는 긴 목록이 흔하다 — 반쪽 칸이면 뒤가 가려져 각각 한 줄 */}
        <Field
          label="업태"
          name="business_type"
          defaultValue={values.business_type}
          placeholder="도매 및 소매업"
          maxLength={BIZ_TYPE_ITEM_MAX}
          readOnly={locked}
        />
        <Field
          label="종목"
          name="business_item"
          defaultValue={values.business_item}
          placeholder="철강재"
          maxLength={BIZ_TYPE_ITEM_MAX}
          readOnly={locked}
        />
        <Field label="주소" name="address" defaultValue={values.address} readOnly={locked} />
        <Field label="메모" name="notes" defaultValue={values.notes} readOnly={locked} />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={values.is_active}
            className="size-4"
            aria-disabled={locked}
            // 잠금 중에도 값은 보내야 하므로 disabled 대신 클릭만 막는다
            onClick={(e) => {
              if (locked) e.preventDefault();
            }}
          />
          활성 상태
        </label>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {saved ? "닫기" : "취소"}
          </Button>
          <Button type="submit" disabled={busy || !!choice}>
            {pending ? "저장 중..." : current ? "수정" : "추가"}
          </Button>
        </DialogFooter>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  uppercase,
  type,
  format,
  readOnly,
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  uppercase?: boolean;
  type?: string;
  format?: NumberFormat; // 전화·사업자번호 자동 대시
  readOnly?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <FormattedInput
        format={format}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
        readOnly={readOnly}
        maxLength={maxLength}
        style={uppercase ? { textTransform: "uppercase" } : undefined}
      />
    </label>
  );
}
