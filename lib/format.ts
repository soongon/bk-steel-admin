// 숫자·통화 표기 공통 포맷터 — 화면 전반에서 동일한 한국 로캘 표기를 쓰기 위함.

/** ₩1,234,567 — 원 단위 통화(반올림 + ₩ 기호). */
export const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

/** 1,234.5 — 천단위 구분 + 소수 자릿수(기본 1, 철근 중량 등). */
export const fmtNum = (n: number, d = 1) =>
  n.toLocaleString("ko-KR", { maximumFractionDigits: d });

// ── 연락처: 저장은 숫자만, 표시는 대시 포함 ──

/** 숫자만 추출 (저장용). 입력에서 대시·공백 등 제거. */
export const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** 사업자등록번호 표기 — 10자리면 000-00-00000(3-2-5), 그 외는 숫자 원본. */
export function formatBusinessNo(s: string | null | undefined): string {
  const d = digitsOnly(s);
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  return d;
}

/** 전화·팩스·휴대폰 표기 — 자릿수·국번별 대시. 알 수 없으면 숫자 원본. */
export function formatPhone(s: string | null | undefined): string {
  const d = digitsOnly(s);
  if (!d) return "";
  // 대표번호 1588/1644/1800 등 8자리
  if (d.length === 8 && d.startsWith("1")) return `${d.slice(0, 4)}-${d.slice(4)}`;
  // 서울 02 (9~10자리)
  if (d.startsWith("02")) {
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`;
    if (d.length === 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`;
  }
  // 휴대폰·일반 11자리: 3-4-4
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  // 일반 지역/070/구휴대폰 10자리: 3-3-4
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}
