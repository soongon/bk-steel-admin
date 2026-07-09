import { type ReactNode } from "react";

/** 폼 라벨 + 입력 세로 배치 — 폼 다이얼로그 공통(라벨 위, 입력 아래). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
