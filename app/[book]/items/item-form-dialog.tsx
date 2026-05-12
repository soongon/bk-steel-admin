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
import {
  createItem,
  updateItem,
  type ItemActionResult,
  type ItemCategory,
} from "./actions";

export type ItemRow = {
  id: string;
  code: string;
  name: string;
  category: ItemCategory;
  rebar_spec_code: string | null;
  rebar_grade_code: string | null;
  length_m: number | null;
  spec_text: string | null;
  weight_per_unit_kg: number | null;
  is_active: boolean;
};

export type RebarSpecOption = {
  spec_code: string;
  nominal_diameter_mm: number | string;
  unit_weight_kg_per_m: number | string;
  standard_length_m: number;
};

export type RebarGradeOption = {
  grade_code: string;
  yield_strength_mpa: number;
  category: string;
};

const CATEGORY_OPTIONS: { value: ItemCategory; label: string }[] = [
  { value: "rebar", label: "철근" },
  { value: "hbeam", label: "H빔" },
  { value: "pipe", label: "각파이프·강관" },
  { value: "scrap", label: "고철·중고철근" },
  { value: "etc", label: "기타" },
];

export function ItemFormDialog({
  open,
  onOpenChange,
  editing,
  specs,
  grades,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ItemRow | null;
  specs: RebarSpecOption[];
  grades: RebarGradeOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<ItemCategory>(
    editing?.category ?? "rebar",
  );
  const [specCode, setSpecCode] = useState(editing?.rebar_spec_code ?? "");
  const [gradeCode, setGradeCode] = useState(editing?.rebar_grade_code ?? "");
  const [lengthM, setLengthM] = useState(
    editing?.length_m != null ? String(editing.length_m) : "8",
  );

  useEffect(() => {
    if (open) {
      setError(null);
      setCategory(editing?.category ?? "rebar");
      setSpecCode(editing?.rebar_spec_code ?? "");
      setGradeCode(editing?.rebar_grade_code ?? "");
      setLengthM(editing?.length_m != null ? String(editing.length_m) : "8");
    }
  }, [open, editing]);

  // 미리보기: rebar 라면 자동 코드·이름·단위중량
  const preview = useMemo(() => {
    if (category !== "rebar" || !specCode || !gradeCode) return null;
    const len = Number(lengthM) || null;
    const spec = specs.find((s) => s.spec_code === specCode);
    const lenLabel = len ? `${len}M` : "";
    const specClean = specCode.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const code = ["REBAR", specClean, gradeCode, lenLabel]
      .filter(Boolean)
      .join("_");
    const name = `철근 ${specCode} ${gradeCode}${len ? ` ${len}M` : ""}`;
    const weightPerBar =
      spec && len ? Number(spec.unit_weight_kg_per_m) * len : null;
    return { code, name, weightPerBar };
  }, [category, specCode, gradeCode, lengthM, specs]);

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: ItemActionResult = editing
        ? await updateItem(editing.id, formData)
        : await createItem(formData);
      if (result.ok) {
        toast.success(editing ? "품목이 수정되었습니다" : "품목이 추가되었습니다");
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  const isRebar = category === "rebar";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "품목 수정" : "신규 품목 등록"}</DialogTitle>
          <DialogDescription>
            공유 마스터 — 매출·매입에서 품목 선택의 기준이 됩니다.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="flex flex-col gap-3" key={editing?.id ?? "new"}>
          {/* 카테고리 */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">카테고리 *</span>
            <select
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ItemCategory)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          {isRebar ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">규격 (spec) *</span>
                  <select
                    name="rebar_spec_code"
                    value={specCode}
                    onChange={(e) => setSpecCode(e.target.value)}
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    required
                  >
                    <option value="">선택</option>
                    {specs.map((s) => (
                      <option key={s.spec_code} value={s.spec_code}>
                        {s.spec_code} ({Number(s.unit_weight_kg_per_m).toFixed(3)}kg/m)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">등급 (grade) *</span>
                  <select
                    name="rebar_grade_code"
                    value={gradeCode}
                    onChange={(e) => setGradeCode(e.target.value)}
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    required
                  >
                    <option value="">선택</option>
                    {grades.map((g) => (
                      <option key={g.grade_code} value={g.grade_code}>
                        {g.grade_code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">길이 (M)</span>
                  <Input
                    name="length_m"
                    type="number"
                    step="0.1"
                    value={lengthM}
                    onChange={(e) => setLengthM(e.target.value)}
                    placeholder="8"
                  />
                </label>
              </div>
              {preview ? (
                <div className="rounded-md bg-muted/40 p-2 text-xs">
                  <div>
                    코드 <span className="font-mono">{preview.code}</span>
                  </div>
                  <div>
                    이름 <span className="font-medium">{preview.name}</span>
                  </div>
                  {preview.weightPerBar ? (
                    <div className="text-muted-foreground">
                      가닥당 약 {preview.weightPerBar.toFixed(2)} kg
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={editing ? "코드 *" : "코드 *"}
                  name="code"
                  defaultValue={editing?.code}
                  placeholder="HBEAM_300x300x10x15_6M"
                  uppercase
                />
                <Field
                  label="품목명 *"
                  name="name"
                  defaultValue={editing?.name}
                  placeholder="H빔 300×300×10×15 6M"
                />
              </div>
              <Field
                label="규격(자유텍스트)"
                name="spec_text"
                defaultValue={editing?.spec_text ?? undefined}
                placeholder="300×300×10×15 / SS400 등"
              />
            </>
          )}

          <Field
            label="단위중량(kg)"
            name="weight_per_unit_kg"
            type="number"
            step="0.001"
            defaultValue={
              editing?.weight_per_unit_kg != null
                ? String(editing.weight_per_unit_kg)
                : undefined
            }
            placeholder={isRebar ? "(rebar 는 spec×길이 자동 계산 가능)" : "kg/EA, kg/m 등"}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={editing ? editing.is_active : true}
              className="size-4"
            />
            활성 상태 (콤보 표시)
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중..." : editing ? "수정" : "추가"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  uppercase,
  type,
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  uppercase?: boolean;
  type?: string;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        style={uppercase ? { textTransform: "uppercase" } : undefined}
      />
    </label>
  );
}
