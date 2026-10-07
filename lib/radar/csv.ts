/**
 * CSV 직렬화 — 엑셀 호환(BOM·CRLF) + 수식 주입 방지.
 * 셀 값은 외부 공공API 원문(낙찰사명·공사명·주소)이라 '=·+·-·@·탭'으로 시작하면 엑셀이 수식으로 실행한다 → 앞에 ' 를 붙인다.
 */

export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
