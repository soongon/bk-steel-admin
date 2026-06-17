"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TagIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateSaleLineDisplayNames } from "../actions";

/** 매출 라인의 명세표 표시명 원본 — 철근 여부·기본 라벨·현재 오버라이드. */
export type NameLine = {
  id: string;
  isRebar: boolean;
  defaultName: string; // 철근 또는 품목명
  currentName: string | null;
};

type Field = {
  key: string;
  label: string; // 어떤 품목을 가리키는지(철근 / 품목명)
  placeholder: string; // 기본값
  lineIds: string[]; // 적용 대상 라인
};

/**
 * 거래명세표 '품목명' 라벨 수정 — 보통 '철근'이지만 거래처가 '철근(현대철강)' 식
 * 표기를 원할 때 명세표에 보이는 품목명만 덮어쓴다. 수량·단가·금액은 건드리지 않는다.
 * 철근 라인들은 명세표에서 한 줄('철근')로 합쳐 표기되므로 입력 하나로 묶어 처리한다.
 */
export function SaleLineNameButton({ saleId, lines }: { saleId: string; lines: NameLine[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // 철근은 명세표에서 '철근' 한 줄로 합쳐지므로 하나의 입력으로, 비철근은 라인별 입력.
  const fields = useMemo<Field[]>(() => {
    const rebar = lines.filter((l) => l.isRebar);
    const others = lines.filter((l) => !l.isRebar);
    const fs: Field[] = [];
    if (rebar.length > 0) {
      fs.push({ key: "__rebar__", label: "철근", placeholder: "철근", lineIds: rebar.map((l) => l.id) });
    }
    for (const l of others) {
      fs.push({ key: l.id, label: l.defaultName, placeholder: l.defaultName, lineIds: [l.id] });
    }
    return fs;
  }, [lines]);

  // 초기 입력값: 그룹 첫 라인의 현재 오버라이드.
  const initial = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const f of fields) {
      m[f.key] = lines.find((l) => l.id === f.lineIds[0])?.currentName ?? "";
    }
    return m;
  }, [fields, lines]);

  const [values, setValues] = useState<Record<string, string>>(initial);

  function onSave() {
    const updates = fields.flatMap((f) =>
      f.lineIds.map((id) => ({ id, display_name: (values[f.key] ?? "").trim() || null })),
    );
    start(async () => {
      const r = await updateSaleLineDisplayNames(saleId, updates);
      if (r.ok) {
        toast.success("품목명이 수정되었습니다");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  if (fields.length === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setValues(initial);
          setOpen(true);
        }}
      >
        <TagIcon className="size-4" /> 품목명
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>품목명 수정</DialogTitle>
            <DialogDescription>
              거래명세표에 표시되는 품목명입니다. 비우면 기본값(예: 철근)으로 표시되며, 수량·단가·금액은
              바뀌지 않습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">
                  {f.label}
                  {f.key === "__rebar__" ? " (철근 규격 묶음)" : ""}
                </span>
                <Input
                  value={values[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button onClick={onSave} disabled={pending}>
              {pending ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
