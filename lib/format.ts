// 숫자·통화 표기 공통 포맷터 — 화면 전반에서 동일한 한국 로캘 표기를 쓰기 위함.

/** ₩1,234,567 — 원 단위 통화(반올림 + ₩ 기호). */
export const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

/** 1,234.5 — 천단위 구분 + 소수 자릿수(기본 1, 철근 중량 등). */
export const fmtNum = (n: number, d = 1) =>
  n.toLocaleString("ko-KR", { maximumFractionDigits: d });
