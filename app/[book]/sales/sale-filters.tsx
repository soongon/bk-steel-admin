"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type PartnerOpt = { id: string; name: string };

const STATUS_OPTS = [
  { v: "", l: "상태 전체" },
  { v: "reserved", l: "주문" },
  { v: "confirmed", l: "확정" },
  { v: "delivered", l: "납품완료" },
  { v: "settled", l: "수금완료" },
  { v: "overdue", l: "연체" },
  { v: "cancelled", l: "취소" },
];
const DOC_OPTS = [
  { v: "", l: "자료 전체" },
  { v: "y", l: "자료" },
  { v: "n", l: "무자료" },
];
const GRADE_OPTS = [
  { v: "", l: "미수 전체" },
  { v: "normal", l: "정상" },
  { v: "short", l: "단기(1~7)" },
  { v: "mid", l: "중기(8~30)" },
  { v: "long", l: "장기(31+)" },
];

const FILTER_KEYS = ["from", "to", "partner", "status", "doc", "grade"];

/** 매출 목록 필터 — 기간·거래처·상태·자료성은 서버 쿼리, 미수등급은 클라 적용. URL searchParams 동기화. */
export function SaleFilters({ partners }: { partners: PartnerOpt[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const hasAny = FILTER_KEYS.some((k) => sp.get(k));

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card/50 p-2.5">
      <Field label="주문일">
        <Input type="date" value={get("from")} onChange={(e) => setParam("from", e.target.value)} className="h-8 w-36" />
      </Field>
      <Field label="~">
        <Input type="date" value={get("to")} onChange={(e) => setParam("to", e.target.value)} className="h-8 w-36" />
      </Field>
      <Field label="거래처">
        <select
          value={get("partner")}
          onChange={(e) => setParam("partner", e.target.value)}
          className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">전체</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="상태">
        <Sel value={get("status")} opts={STATUS_OPTS} onChange={(v) => setParam("status", v)} />
      </Field>
      <Field label="자료성">
        <Sel value={get("doc")} opts={DOC_OPTS} onChange={(v) => setParam("doc", v)} />
      </Field>
      <Field label="미수등급">
        <Sel value={get("grade")} opts={GRADE_OPTS} onChange={(v) => setParam("grade", v)} />
      </Field>
      {hasAny ? (
        <Button variant="outline" size="sm" onClick={() => router.push(pathname)}>
          필터 해제
        </Button>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function Sel({
  value,
  opts,
  onChange,
}: {
  value: string;
  opts: { v: string; l: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
    >
      {opts.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}
