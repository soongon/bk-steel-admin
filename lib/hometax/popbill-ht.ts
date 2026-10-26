/**
 * 팝빌 홈택스 전자(세금)계산서 연계(HTTaxinvoice) 래퍼 — 수집 요청 → 완료 대기 → 목록 전부 → 상세.
 * 정액제(사업자번호당 월정액)라 호출 횟수 부담 없음. SDK 로드·config·promisify 는 lib/popbill-config 공용.
 * 운영/테스트는 POPBILL_IS_TEST 로 분기(기본 테스트베드).
 */
import { popbill, popbillConfigure, popbillPromisify } from "@/lib/popbill-config";
import type { HometaxDateType } from "./types";

const PER_PAGE = 1000; // 팝빌 상한
const TYPES = ["N", "M"]; // 일반 / 수정
const TAX_TYPES = ["T", "N", "Z"]; // 과세 / 면세 / 영세
const PURPOSES = ["R", "C", "N"]; // 영수 / 청구 / 없음

function svc() {
  popbillConfigure();
  return popbill.HTTaxinvoiceService();
}
const p = popbillPromisify;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 수집 요청 — 팝빌 작업아이디(18자) 반환. 날짜는 'YYYYMMDD'. */
export function htRequestJob(corpNum: string, queryType: "SELL" | "BUY", dateType: HometaxDateType, sDate: string, eDate: string) {
  const s = svc();
  return p<string>((ok, err) => s.requestJob(corpNum, queryType, dateType, sDate, eDate, ok, err));
}

export function htGetJobState(corpNum: string, jobId: string) {
  const s = svc();
  return p<import("popbill").HTJobState>((ok, err) => s.getJobState(corpNum, jobId, ok, err));
}

/** 완료(jobState=3)까지 폴링. 기본 90초. 팝빌 쪽 수집 오류(errorCode)면 throw. */
export async function htWaitJob(corpNum: string, jobId: string, { timeoutMs = 90_000, intervalMs = 2_000 } = {}) {
  const started = Date.now();
  for (;;) {
    const st = await htGetJobState(corpNum, jobId);
    if (st.jobState === 3) {
      if (st.errorCode && Number(st.errorCode) !== 1) {
        throw new Error(`홈택스 수집 실패(${st.errorCode}): ${st.errorReason ?? ""}`.trim());
      }
      return st;
    }
    if (Date.now() - started > timeoutMs) throw new Error("홈택스 수집이 제한 시간 안에 끝나지 않았습니다. 잠시 후 [지금 수집]을 다시 눌러 주세요.");
    await sleep(intervalMs);
  }
}

/** 작업 결과 목록 전부(페이지 순회). 일반+수정, 과세+면세+영세, 영수+청구+없음 모두. */
export async function htSearchAll(corpNum: string, jobId: string): Promise<Array<Record<string, unknown>>> {
  const s = svc();
  const out: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 100; page++) {
    const res = await p<import("popbill").HTSearchResult>((ok, err) =>
      s.search(corpNum, jobId, TYPES, TAX_TYPES, PURPOSES, "", "", "", page, PER_PAGE, "D", ok, err),
    );
    out.push(...(res.list ?? []));
    if (page >= (res.pageCount ?? 1) || (res.list ?? []).length === 0) break;
  }
  return out;
}

/** 승인번호(24자)로 상세(품목 라인·수정사유 포함). */
export function htGetTaxinvoice(corpNum: string, ntsConfirmNum: string) {
  const s = svc();
  return p<Record<string, unknown>>((ok, err) => s.getTaxinvoice(corpNum, ntsConfirmNum, ok, err));
}

/** 정액제 가입 상태(사업자번호 기준). 응답이 boolean 또는 {flatRateState} 로 올 수 있어 둘 다 처리. */
export async function htFlatRateState(corpNum: string): Promise<boolean> {
  const s = svc();
  const r = await p<boolean | { flatRateState?: boolean }>((ok, err) => s.getFlatRateState(corpNum, ok, err));
  return typeof r === "boolean" ? r : Boolean(r?.flatRateState);
}
