// 숫자·통화 표기 공통 포맷터 — 화면 전반에서 동일한 한국 로캘 표기를 쓰기 위함.

/** ₩1,234,567 — 원 단위 통화(반올림 + ₩ 기호). */
export const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

/** 1,234.5 — 천단위 구분 + 소수 자릿수(기본 1, 철근 중량 등). */
export const fmtNum = (n: number, d = 1) =>
  n.toLocaleString("ko-KR", { maximumFractionDigits: d });

/** ISO 시각 → 한국시간 'YYYY-MM-DD HH:mm' (서버가 UTC 여도 같게). */
export function fmtKstDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hourCycle: "h23" }).slice(0, 16);
}

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
  // 050x 안심·평생번호(국번 4자리): 11자리 4-3-4, 12자리 4-4-4
  if (/^050[2-8]/.test(d)) {
    if (d.length === 12) return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`;
    if (d.length === 11) return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  }
  // 휴대폰·일반 11자리: 3-4-4
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  // 일반 지역/070/구휴대폰 10자리: 3-3-4
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

// ── 입력칸 자동 대시: 치는 대로 단계별로 대시를 넣는다. 완성된 번호는 위 표기 함수와 같은 모양 ──

const dashJoin = (...parts: string[]) => parts.filter(Boolean).join("-");

/** 전화 입력 형식 — 010-1234-5678 · 02-123-4567 · 054-777-0293 · 1588-1234 · 0505-123-4567. 자릿수 초과분은 버린다. */
export function formatPhoneInput(s: string | null | undefined): string {
  const d = digitsOnly(s);
  // 서울 02: 2-3-4, 10자리면 2-4-4
  if (d.startsWith("02")) {
    const x = d.slice(0, 10);
    return x.length === 10 ? dashJoin(x.slice(0, 2), x.slice(2, 6), x.slice(6)) : dashJoin(x.slice(0, 2), x.slice(2, 5), x.slice(5));
  }
  // 050x 안심·평생번호: 4-3-4, 12자리면 4-4-4
  if (/^050[2-8]/.test(d)) {
    const x = d.slice(0, 12);
    return x.length === 12 ? dashJoin(x.slice(0, 4), x.slice(4, 8), x.slice(8)) : dashJoin(x.slice(0, 4), x.slice(4, 7), x.slice(7));
  }
  // 휴대폰 010: 처음부터 3-4-4(입력 중 대시 자리가 옮겨 다니지 않게)
  if (d.startsWith("010")) {
    const x = d.slice(0, 11);
    return dashJoin(x.slice(0, 3), x.slice(3, 7), x.slice(7));
  }
  // 그 밖의 0 국번(지역번호·070·080·구 휴대폰): 3-3-4, 11자리면 3-4-4
  if (d.startsWith("0")) {
    const x = d.slice(0, 11);
    return x.length === 11 ? dashJoin(x.slice(0, 3), x.slice(3, 7), x.slice(7)) : dashJoin(x.slice(0, 3), x.slice(3, 6), x.slice(6));
  }
  // 대표번호 15xx·16xx·18xx: 4-4
  if (d.startsWith("1")) {
    const x = d.slice(0, 8);
    return dashJoin(x.slice(0, 4), x.slice(4));
  }
  return d.slice(0, 12); // 알 수 없는 형식 — 숫자만
}

/** 사업자등록번호 입력 형식 — 000-00-00000(10자리까지). */
export function formatBusinessNoInput(s: string | null | undefined): string {
  const d = digitsOnly(s).slice(0, 10);
  return dashJoin(d.slice(0, 3), d.slice(3, 5), d.slice(5));
}
