"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { classifyAndProcess } from "./actions";

/** 매입 수집본 '분류 대기' 행 — [재고 매입] / [비용] 한 번 누르면 거래처 종류가 정해지고 그 건이 바로 처리된다. */
export function ClassifyButtons({ nts, supplierName, suggestion }: { nts: string; supplierName: string | null; suggestion?: "inventory" | "expense" | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const run = (kind: "inventory" | "expense") => {
    if (!window.confirm(`${supplierName ?? "이 공급자"}를 ${kind === "inventory" ? "재고 매입처" : "비용 업체"}로 정하고 이 계산서를 ${kind === "inventory" ? "매입으로 생성" : "영수증(비용)으로 등록"}할까요?\n다음 계산서부터는 자동으로 같은 처리가 됩니다.`)) return;
    start(async () => {
      const r = await classifyAndProcess(nts, kind);
      if (r.ok) {
        toast.success(r.message);
        setDone(kind);
        router.refresh();
      } else toast.error(r.error);
    });
  };
  if (done) return <span className="text-[10px] text-muted-foreground">처리됨</span>;
  const cls = (hl: boolean) => `rounded border px-1.5 py-0.5 text-[10px] ${hl ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted"}`;
  return (
    <span className="inline-flex gap-1">
      <button type="button" disabled={pending} onClick={() => run("inventory")} className={cls(suggestion === "inventory")} title="재고 매입처로 지정 + 매입 생성(품목 미정)">
        재고 매입
      </button>
      <button type="button" disabled={pending} onClick={() => run("expense")} className={cls(suggestion === "expense")} title="비용 업체로 지정 + 영수증·비용 등록">
        비용
      </button>
    </span>
  );
}
