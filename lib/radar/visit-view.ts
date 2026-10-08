/**
 * 방문 탭 뷰 모델 — 순수 변환. 화면(app/radar)·알림(radar-collect)·CSV·측정이 같은 함수를 쓴다.
 * DB 행 + 영업내역(sales_log, project_id 연결) → 화면 행(상태·밴드·N일째·담당자). 기획안 §4.3·§5.
 */

import {
  PERMANENT_DISMISS_REASON,
  RESULT_REFUSED,
  normalizeResultCode,
  bandOf,
  companyHintFromLogs,
  daysSince,
  deriveStatus,
  effectiveStageTime,
  emdOf,
  titleHint,
  visitRuleMatch,
  withinVisitWindow,
  type DistanceBand,
  type RowStatus,
  type TouchLog,
} from "./v2-rules";
import type { RadarRegion, RadarSource, RadarStage } from "./types";

/** construction_project 에서 읽는 컬럼(+ raw 투영). lib/radar/radar-data.ts VISIT_COLS 와 1:1. */
export interface VisitSourceRow {
  id: string;
  source: RadarSource;
  region: RadarRegion;
  stage: RadarStage;
  floor_area: number | null;
  usage: string | null;
  address: string | null;
  title: string;
  permit_date: string | null;
  start_date: string | null;
  stage_changed_at: string | null;
  created_at: string | null;
  dismissed_at: string | null;
  dismiss_reason: string | null;
  main_purps: string | null; // raw->>mainPurpsCdNm
  arch_gb: string | null; //    raw->>archGbCdNm (신축/증축)
  block: string | null; //      raw->>block
  linked_partner_id?: string | null;
  linked_partner?: { name: string; deleted_at?: string | null } | null; // 연결된 거래처(★) — 삭제된 거래처는 미연결로 본다
}

export interface VisitViewRow {
  id: string;
  address: string;
  titleHint: string | null; // 제목이 주소의 반복이 아닐 때만(회사·개인명 등 힌트)
  stage: "permit" | "construction_start";
  days: number | null; // 착공 N일째 / 허가 N일째
  emd: string | null;
  band: DistanceBand;
  mainPurps: string | null;
  archGb: string | null;
  floorArea: number | null;
  stageChangedAt: string | null; // 단계 반영 시각(없으면 최초 수집)
  permitDate: string | null;
  startDate: string | null;
  status: RowStatus;
  logs: TouchLog[]; // 최신순
  lastLog: TouchLog | null;
  contactName: string | null; // 확보한 담당자(가장 최근 기록 기준)
  contactPhone: string | null; // 숫자만(표시는 formatPhone)
  dismissedAt: string | null;
  dismissReason: string | null;
  /** [복구] 가능 — 영구 제외가 아니고, 복구 뒤에도 목록에 남는 행(기록이 있거나 규칙·60일 창 안). */
  restorable: boolean;
  mapUrl: string;
  /** 연결된 거래처(★) — [거래처로] 저장 또는 사업자번호 자동 연결 */
  partnerId: string | null;
  partnerName: string | null;
  /** 방문 기록에서 확보한 시공사·업체명([견적]·[거래처로] 미리 채우기) */
  companyHint: string | null;
}

export function buildVisitRows(
  rows: VisitSourceRow[],
  logsByProject: Map<string, TouchLog[]>,
  today: string,
): VisitViewRow[] {
  const out: VisitViewRow[] = [];
  for (const r of rows) {
    if (r.stage !== "permit" && r.stage !== "construction_start") continue;
    const logs = [...(logsByProject.get(r.id) ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const contacted = logs.length > 0;
    const stageTime = effectiveStageTime(r.stage_changed_at, r.created_at);
    const inRule = visitRuleMatch(r) && withinVisitWindow(stageTime, today);
    // 미접촉·미처분 행만 규칙·창 적용. 기록이 있거나 제외된 행은 처분될 때까지/완료 탭에 남는다.
    if (!contacted && !r.dismissed_at && !inRule) continue;
    const address = r.address?.trim() || r.title;
    const emd = emdOf(r.address, r.title);
    const lastLog = logs[0] ?? null;
    const withContact = logs.find((l) => l.contact_person || l.contact_phone) ?? null;
    out.push({
      id: r.id,
      address,
      titleHint: titleHint(r.title, r.address),
      stage: r.stage,
      days: daysSince(r.stage === "construction_start" ? r.start_date : r.permit_date, today),
      emd,
      band: bandOf(emd),
      mainPurps: r.main_purps,
      archGb: r.arch_gb,
      floorArea: r.floor_area,
      stageChangedAt: stageTime,
      permitDate: r.permit_date,
      startDate: r.start_date,
      status: deriveStatus({ dismissed_at: r.dismissed_at, stage_changed_at: stageTime, logs }, today),
      logs,
      lastLog,
      contactName: withContact?.contact_person ?? null,
      contactPhone: withContact?.contact_phone ?? null,
      dismissedAt: r.dismissed_at,
      dismissReason: r.dismiss_reason,
      restorable:
        !!r.dismissed_at &&
        r.dismiss_reason !== PERMANENT_DISMISS_REASON &&
        !logs.some((l) => normalizeResultCode(l.result) === RESULT_REFUSED) && // 영업내역 '거절' = 수신거부
        (contacted || inRule), // 복구 뒤에도 목록에 남는 행만
      mapUrl: `https://map.kakao.com/link/search/${encodeURIComponent(address)}`,
      partnerId: r.linked_partner && !r.linked_partner.deleted_at ? (r.linked_partner_id ?? null) : null,
      partnerName: r.linked_partner && !r.linked_partner.deleted_at ? r.linked_partner.name : null,
      companyHint: companyHintFromLogs(logs, r.address, r.title),
    });
  }
  // 밴드 → 착공 먼저 → 날짜 최신순
  const bandOrder: Record<DistanceBand, number> = { near: 0, mid: 1, far: 2 };
  out.sort((a, b) => {
    if (bandOrder[a.band] !== bandOrder[b.band]) return bandOrder[a.band] - bandOrder[b.band];
    if (a.stage !== b.stage) return a.stage === "construction_start" ? -1 : 1;
    const da = a.stage === "construction_start" ? a.startDate : a.permitDate;
    const db = b.stage === "construction_start" ? b.startDate : b.permitDate;
    return (db ?? "").localeCompare(da ?? "");
  });
  return out;
}
