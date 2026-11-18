"use client";

// 철근 길이 직접 입력(6.5M 등 목록에 없는 길이) — 매출·견적·매입 폼 공용 상태·입력칸.
// 규격·강종을 고르고 길이(m)를 넣으면 그 품목 id 를 돌려준다. 품목이 아직 없으면 임시 id 로 환산·미리보기를 하고,
// 저장할 때 서버가 실제 품목으로 바꾼다(lib/rebar-item resolveCustomRebarItems → ensure_rebar_item, 0103).
// 비공인 길이는 가닥으로 거래 — 매출·견적 폼은 단위를 가닥으로 고정, 매입 폼은 가닥·kg(계근 실중량)만. 중량 = 가닥 × 단위중량(kg/m) × 길이.

import { useCallback, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  isRebarItem,
  parseRebarLength,
  customRebarItemId,
  customRebarItem,
  REBAR_CUSTOM_LENGTH_MAX,
} from "@/lib/rebar";

type MasterItem = {
  id: string;
  category: string;
  rebar_spec_code: string | null;
  rebar_grade_code: string | null;
  length_m: number | null;
};
type CustomRebarItem = NonNullable<ReturnType<typeof customRebarItem>>;

/** 품목을 못 정했을 때(규격·길이 미입력) 안내. */
export const REBAR_CUSTOM_LENGTH_HINT = `규격을 고르고 길이(${REBAR_CUSTOM_LENGTH_MAX}m 이하)를 입력해주세요.`;

/** 입력칸·토글이 쓰는 부분(폼 품목 타입과 무관). */
export type RebarCustomLengthControls = {
  on: boolean;
  setOn: (on: boolean) => void;
  spec: string;
  setSpec: (spec: string) => void;
  grade: string;
  setGrade: (grade: string) => void;
  lenStr: string;
  setLenStr: (len: string) => void;
  grades: string[];
};

/**
 * 길이 직접 입력 상태.
 *   · itemId — 켜져 있고 규격·강종·길이가 다 있으면 그 품목 id(이미 있으면 실제 품목, 없으면 임시 id), 아니면 "".
 *   · items — 품목 마스터 + 아직 품목이 없는 직접 입력 길이(현재 입력·추가된 라인). 환산·미리보기·직렬화가 이 목록을 쓴다.
 *   · reset — 폼을 열 때(끄고 비움). clearSpec — 라인을 추가한 뒤(길이·강종은 남겨 같은 길이로 규격만 바꿔 이어 넣기).
 */
export function useRebarCustomLength<I extends MasterItem>(masterItems: I[], lines: { itemId: string }[]) {
  const [on, setOn] = useState(false);
  const [spec, setSpec] = useState("");
  const [grade, setGrade] = useState("SD400");
  const [lenStr, setLenStr] = useState("");
  const lengthM = parseRebarLength(lenStr);

  const itemId = useMemo(() => {
    if (!on || !spec || !grade || lengthM == null) return "";
    const existing = masterItems.find(
      (i) =>
        isRebarItem(i) &&
        i.rebar_spec_code === spec &&
        i.rebar_grade_code === grade &&
        Number(i.length_m) === lengthM,
    );
    return existing?.id ?? customRebarItemId(spec, grade, lengthM);
  }, [on, spec, grade, lengthM, masterItems]);

  const items = useMemo((): (I | CustomRebarItem)[] => {
    const ids = new Set([...lines.map((l) => l.itemId), itemId]);
    const virtual = [...ids].map(customRebarItem).filter((v): v is CustomRebarItem => v !== null);
    return virtual.length > 0 ? [...masterItems, ...virtual] : masterItems;
  }, [masterItems, lines, itemId]);

  // 강종 선택지 — 품목 마스터에 있는 강종(SD400 → SD500 → SD600).
  const grades = useMemo(() => {
    const set = new Set(masterItems.filter(isRebarItem).map((i) => i.rebar_grade_code).filter((g): g is string => !!g));
    set.add("SD400");
    const mpa = (g: string) => parseInt(g.replace(/\D/g, ""), 10) || 0;
    return [...set].sort((a, b) => mpa(a) - mpa(b) || a.localeCompare(b));
  }, [masterItems]);

  const reset = useCallback(() => {
    setOn(false);
    setSpec("");
    setLenStr("");
  }, []);
  const clearSpec = useCallback(() => setSpec(""), []);

  return { on, setOn, spec, setSpec, grade, setGrade, lenStr, setLenStr, grades, itemId, items, reset, clearSpec };
}

/** 품목 칸 자리 — 규격·강종·길이(m) 세 칸. 384px 폼에 들어가게 좁게. */
export function RebarCustomLengthInputs({
  custom,
  rebarSpecs,
}: {
  custom: RebarCustomLengthControls;
  rebarSpecs: { spec_code: string }[];
}) {
  const selectClass = "h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-1 text-sm";
  return (
    <div className="flex gap-1">
      <select value={custom.spec} onChange={(e) => custom.setSpec(e.target.value)} aria-label="규격" className={selectClass}>
        <option value="">규격</option>
        {rebarSpecs.map((sp) => (
          <option key={sp.spec_code} value={sp.spec_code}>
            {sp.spec_code}
          </option>
        ))}
      </select>
      <select value={custom.grade} onChange={(e) => custom.setGrade(e.target.value)} aria-label="강종" className={selectClass}>
        {custom.grades.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <Input
        type="number"
        step="0.1"
        min="0"
        max={REBAR_CUSTOM_LENGTH_MAX}
        value={custom.lenStr}
        onChange={(e) => custom.setLenStr(e.target.value)}
        placeholder="길이 m"
        aria-label="길이(m)"
        className="w-[4.5rem] shrink-0 px-2"
      />
    </div>
  );
}

/** 품목 칸 아래 토글. onToggle 에서 폼이 고른 품목을 비우고, 켤 때 단위를 가닥으로 맞춘다. */
export function RebarCustomLengthToggle({
  custom,
  onToggle,
  unitNote = "가닥 단위",
}: {
  custom: RebarCustomLengthControls;
  onToggle: (on: boolean) => void;
  /** 쓸 수 있는 단위 안내 — 매출·견적은 가닥만, 매입은 가닥·kg. */
  unitNote?: string;
}) {
  return (
    <label className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={custom.on}
        onChange={(e) => {
          custom.setOn(e.target.checked);
          onToggle(e.target.checked);
        }}
        className="size-3.5 accent-foreground"
      />
      길이 직접 입력 — 목록에 없는 길이(6.5M 등, {unitNote})
    </label>
  );
}
