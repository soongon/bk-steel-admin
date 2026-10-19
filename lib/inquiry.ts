/**
 * 홈페이지 문의(sl-steel.co.kr 문의 폼) — 화면 공용 상수·순수 함수. DB 접근 없음(클라이언트에서도 import 가능).
 * 원본은 홈페이지 전용 Supabase 의 inquiries 테이블(홈페이지 repo sl-steel 마이그레이션 005·007).
 * 읽기·상태 변경은 서버 전용 lib/homepage-inquiry.ts.
 */
import { digitsOnly } from "@/lib/format";
import { type LeadSource } from "@/lib/lead-source";

/** 홈페이지 주소 — 블로그 등 아직 홈페이지 관리자에 남은 기능은 여기로 링크한다. */
export const HOMEPAGE_URL = "https://www.sl-steel.co.kr";

/** 홈페이지 관리자의 상태값 그대로(new/read/resolved) — 두 화면이 같은 행을 같이 바꾼다. */
export const INQUIRY_STATUSES = [
  { value: "new", label: "새 문의", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
  { value: "read", label: "확인", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  { value: "resolved", label: "완료", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number]["value"];

export function isInquiryStatus(v: unknown): v is InquiryStatus {
  return typeof v === "string" && INQUIRY_STATUSES.some((s) => s.value === v);
}

export function inquiryStatusMeta(status: string): { label: string; cls: string } {
  return INQUIRY_STATUSES.find((s) => s.value === status) ?? { label: status, cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" };
}

/** 폼이 hidden 으로 보낸 유입 정보(홈페이지 007 source). 2026-10-16 전 접수분은 비어 있다. */
export type InquirySource = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer?: string; // 호스트만
  landing_path?: string;
  qr_src?: string; // /q?src= (card|truck|flyer|site|qr)
  page_type?: string; // 폼에서 고른 구분
};

export type Inquiry = {
  id: string;
  inquiry_type: string; // '매입 문의' | '납품 문의'
  name: string; // 성함/업체명
  phone: string; // 숫자만 — 단 2026-10 전 접수분엔 하이픈이 섞여 있다(비교는 phoneKey)
  location: string | null; // 현장/지역
  message: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  source: InquirySource | null;
  submit_count: number | null; // 10분 안 같은 번호 재제출은 한 행으로 합치고 +1
  notified_at: string | null; // 알림 메일 발송 시각(없으면 미발송)
};

/** 문의 구분 → 우리 쪽 견적 종류. 매입 문의 = 우리가 산다(매입견적서), 납품 문의 = 우리가 판다(견적서). */
export function inquiryKind(type: string): "purchase" | "sale" | null {
  if (type.includes("매입")) return "purchase";
  if (type.includes("납품")) return "sale";
  return null;
}

/** '매입 문의' → '매입' (배지·제목용). */
export function inquiryKindLabel(type: string): string {
  return type.replace(/\s*문의$/, "") || type;
}

export const INQUIRY_KIND_CLS = {
  purchase: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  sale: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
} as const;

/** 전화 비교 키 — 숫자만(옛 접수분 하이픈·거래처 저장 형식 차이 흡수). */
export const phoneKey = (phone: string | null | undefined) => digitsOnly(phone);

/**
 * 유입 → 어드민 유입경로(lead_source) 추정. 홈페이지 lib/inquiry-guard.ts guessLeadSource 와 같은 규칙
 * (광고 → QR → 블로그 → 플레이스 → 그 외 홈페이지). 유입 정보가 없는 옛 접수분도 홈페이지 폼으로 왔으니 homepage.
 */
export function guessLeadSource(src: InquirySource | null | undefined): LeadSource {
  const s = src ?? {};
  const ref = (s.referrer ?? "").toLowerCase();
  const medium = (s.utm_medium ?? "").toLowerCase();
  const utmSource = (s.utm_source ?? "").toLowerCase();
  if (medium === "cpc" || medium === "paid" || utmSource.includes("powerlink")) return "ad";
  if (s.qr_src) return "other";
  if (ref.includes("blog.naver.com") || utmSource === "blog") return "blog";
  if (ref.includes("place.naver.com") || ref.includes("map.naver.com") || utmSource === "place") return "naver_place";
  return "homepage";
}

const QR_LABEL: Record<string, string> = { card: "명함 QR", truck: "차량 QR", flyer: "전단 QR", site: "현장 QR", qr: "QR" };

/** 유입 상세 한 줄 — 배지(guessLeadSource) 옆에 붙인다. 예: "명함 QR", "search.naver.com · 캠페인명". 없으면 "". */
export function describeSource(src: InquirySource | null | undefined): string {
  if (!src) return "";
  const parts: string[] = [];
  if (src.qr_src) parts.push(QR_LABEL[src.qr_src] ?? `QR:${src.qr_src}`);
  if (src.referrer) parts.push(src.referrer);
  if (src.utm_source && !src.referrer) parts.push(src.utm_source);
  if (src.utm_campaign) parts.push(src.utm_campaign);
  return parts.join(" · ");
}
