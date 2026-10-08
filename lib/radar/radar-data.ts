/**
 * 발주 레이더 v2 데이터 로더 — 화면(app/radar/page.tsx)·알림(scripts/radar-collect)·CSV(radar-v2-export)·
 * 측정(radar-v2-measure)·정리 검증(radar-v2-cleanup)이 같은 쿼리·규칙으로 같은 숫자를 낸다.
 * 클라이언트는 주입(화면 = 사용자 세션 RLS, 스크립트 = service_role). 읽기 전용 + linkSalesLogNotes 만 쓰기.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPhone } from "../format";
import { digits, phoneKey, phoneMatches, telValid } from "./nara-rules";
import {
  PHONE_WINDOW_RC_DAYS,
  RESULT_REFUSED,
  RESULT_UNREACHABLE,
  VISIT_WINDOW_DAYS,
  extractRadarId,
  isDismissResult,
  normalizeResultCode,
  phoneRuleMatch,
  naraLabelOf,
  preRadarPartner,
  type PhoneMatch,
  type TouchLog,
} from "./v2-rules";
import { buildVisitRows, type VisitSourceRow, type VisitViewRow } from "./visit-view";

const MS_DAY = 86_400_000;
/** URL 길이(PostgREST GET) 보호 — UUID 36자 × 100 ≈ 3.7KB. */
const IN_CHUNK = 100;
const PAGE = 1000;
/** 완료 탭 노출 기간(제외 시각 기준). */
export const DONE_DAYS = 90;

/** 오늘(KST) YYYY-MM-DD. */
export function kstToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

type Res<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
async function fetchAllPages<T>(build: (from: number, to: number) => Res<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ── 방문 탭 ───────────────────────────────────────────────────
const VISIT_COLS =
  "id, source, region, stage, floor_area, usage, address, title, permit_date, start_date, stage_changed_at, created_at, dismissed_at, dismiss_reason, main_purps:raw->>mainPurpsCdNm, arch_gb:raw->>archGbCdNm, block:raw->>block, linked_partner_id, linked_partner:partner!construction_project_linked_partner_id_fkey(name, deleted_at)";
const LOG_COLS = "project_id, created_at, contacted_on, follow_up_on, result, contact_person, contact_phone, notes, channel, prospect_name";

/**
 * 방문 탭 행 — ① 미처분 ∧ 단계 반영 60일(+여유) ② 최근 90일 제외 행 ③ 기록(sales_log.project_id)이 있는 행(창 밖이어도
 * 처분될 때까지 남음; 단 90일 넘은 제외 행은 제외). 정밀 판정·상태 파생은 buildVisitRows.
 */
export async function loadVisitRows(sb: SupabaseClient, today: string): Promise<VisitViewRow[]> {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const sinceWindow = new Date(todayMs - (VISIT_WINDOW_DAYS + 2) * MS_DAY).toISOString();
  const sinceDone = new Date(todayMs - DONE_DAYS * MS_DAY).toISOString();
  const base = () =>
    sb
      .from("construction_project")
      .select(VISIT_COLS)
      .eq("source", "building_permit")
      .eq("region", "gyeongju")
      .in("stage", ["permit", "construction_start"])
      .is("deleted_at", null);

  const [inWindow, dismissed, logs] = await Promise.all([
    fetchAllPages<VisitSourceRow>((a, b) =>
      base()
        .is("dismissed_at", null)
        .or(`stage_changed_at.gte.${sinceWindow},and(stage_changed_at.is.null,created_at.gte.${sinceWindow})`)
        .order("id")
        .range(a, b) as unknown as Res<VisitSourceRow>,
    ),
    fetchAllPages<VisitSourceRow>((a, b) =>
      base().not("dismissed_at", "is", null).gte("dismissed_at", sinceDone).order("id").range(a, b) as unknown as Res<VisitSourceRow>,
    ),
    // 방문(민간) 행에 붙은 기록만 — 전화 캠페인 기록이 쌓여도 이 쿼리는 커지지 않는다.
    fetchAllPages<TouchLog & { project_id: string }>((a, b) =>
      sb
        .from("sales_log")
        .select(`${LOG_COLS}, construction_project!inner(source)`)
        .eq("construction_project.source", "building_permit")
        .not("project_id", "is", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(a, b) as unknown as Res<TouchLog & { project_id: string }>,
    ),
  ]);

  const rowsById = new Map<string, VisitSourceRow>();
  for (const r of [...inWindow, ...dismissed]) rowsById.set(r.id, r);
  const logsByProject = new Map<string, TouchLog[]>();
  for (const l of logs) {
    if (!logsByProject.has(l.project_id)) logsByProject.set(l.project_id, []);
    logsByProject.get(l.project_id)!.push(l);
  }
  // 기록이 있는데 ①·②에 없는 행(창 밖 미처분·준공 전환 전) 보강 — 90일 넘은 제외 행은 다시 살리지 않는다.
  const missing = [...logsByProject.keys()].filter((id) => !rowsById.has(id));
  for (const ids of chunks(missing, IN_CHUNK)) {
    const { data, error } = await base().in("id", ids).or(`dismissed_at.is.null,dismissed_at.gte.${sinceDone}`);
    if (error) throw new Error(`방문 행 보강 조회 실패: ${error.message}`);
    for (const r of (data ?? []) as unknown as VisitSourceRow[]) rowsById.set(r.id, r);
  }
  return buildVisitRows([...rowsById.values()], logsByProject, today);
}

// ── 전화 탭(낙찰사 계정) ──────────────────────────────────────
export interface PhoneAward {
  id: string;
  title: string;
  ordering_org: string | null;
  stage_date: string | null;
  est_amount: number | null;
  rc: boolean;
}
export interface PhoneAccount {
  bizno: string; // 숫자만(없으면 낙찰사명)
  company: string | null;
  ceo: string | null;
  tel: string | null;
  addr: string | null;
  match: PhoneMatch;
  partnerName: string | null; // ★ 기존 거래처
  awards: PhoneAward[]; // 규칙에 걸린 낙찰, 최신순
  missing: string[]; // 필수 5필드 공란(낙찰사명·대표·전화·사업자번호·소재지)
  lastTouch: { contacted_on: string; result: string | null } | null; // 이 계정의 마지막 접촉(영업내역)
}
export interface PhoneLoad {
  accounts: PhoneAccount[];
  /** 창 안인데 전화 마스킹만으로 빠진 계정 수(전국건설업체정보 API 보완 대상) */
  maskedInWindow: number;
  /** 사업자번호(10자리)가 있는 거래처 수 / 전체 */
  partnersWithBizno: number;
  partnersTotal: number;
}

type AwardRow = {
  id: string;
  title: string;
  ordering_org: string | null;
  stage_date: string | null;
  est_amount: number | null;
  awarded_company: string | null;
  awardee_bizno: string | null;
  linked_partner_id: string | null;
  tel: string | null;
  addr: string | null;
  ceo: string | null;
  cnstwk: string | null;
};

type Touch = { contacted_on: string; result: string | null; created_at: string };

/**
 * 계정 숨김 판정(순수) — 수신거부('거절')가 이력에 한 번이라도 있거나, 최신 기록이 연락 불가(현장 없음·폐업)일 때.
 * 연락 불가는 복구 가능한 사유라 최신 기록 기준(뒤에 '견적 요청'이 오면 다시 보임) — 방문 탭 deriveStatus 와 같은 의미.
 */
export function hiddenByTouches(ts: Touch[]): boolean {
  if (ts.length === 0) return false;
  if (ts.some((t) => normalizeResultCode(t.result) === RESULT_REFUSED)) return true;
  const latest = ts.reduce((x, y) => (x.created_at >= y.created_at ? x : y));
  return normalizeResultCode(latest.result) === RESULT_UNREACHABLE;
}

/**
 * 관급 계정별 접촉 기록 — 영업내역(project_id 연결분 + 메모 "레이더 {id}" 미연결분).
 * 계정 키 = 사업자번호, 없으면 행 id(회사명으로 묶으면 동명 타사가 합쳐진다).
 */
async function loadNaraTouches(sb: SupabaseClient): Promise<Map<string, Touch[]>> {
  type L = Touch & { project_id: string | null; notes: string | null };
  type Linked = L & { construction_project: { id: string; awardee_bizno: string | null } };
  const [linked, noted] = await Promise.all([
    fetchAllPages<Linked>((a, b) =>
      sb
        .from("sales_log")
        .select("contacted_on, result, created_at, project_id, notes, construction_project!inner(id, awardee_bizno, source)")
        .eq("construction_project.source", "nara_bid")
        .not("project_id", "is", null)
        .is("deleted_at", null)
        .order("created_at")
        .range(a, b) as unknown as Res<Linked>,
    ),
    fetchAllPages<L>((a, b) =>
      sb
        .from("sales_log")
        .select("contacted_on, result, created_at, project_id, notes")
        .is("project_id", null)
        .is("deleted_at", null)
        .ilike("notes", "%레이더%")
        .order("created_at")
        .range(a, b) as unknown as Res<L>,
    ),
  ]);
  const out = new Map<string, Touch[]>();
  const add = (key: string | null | undefined, l: L) => {
    if (!key) return;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({ contacted_on: l.contacted_on, result: l.result, created_at: l.created_at });
  };
  for (const l of linked) add(l.construction_project?.awardee_bizno ?? l.construction_project?.id, l);
  // 메모에만 id 가 있는(아직 연결 전) 기록 — 다음 수집 cron 전에도 거절이 즉시 반영되게
  const ids = [...new Set(noted.map((l) => extractRadarId(l.notes)).filter((x): x is string => !!x))];
  const keyById = new Map<string, string>();
  for (const part of chunks(ids, IN_CHUNK)) {
    const { data, error } = await sb.from("construction_project").select("id, awardee_bizno").eq("source", "nara_bid").in("id", part);
    if (error) throw new Error(`메모 기록 계정 조회 실패: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string; awardee_bizno: string | null }>) keyById.set(r.id, r.awardee_bizno ?? r.id);
  }
  for (const l of noted) add(keyById.get(extractRadarId(l.notes) ?? ""), l);
  return out;
}

export async function loadPhoneAccounts(sb: SupabaseClient, today: string): Promise<PhoneLoad> {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const since = new Date(todayMs - (PHONE_WINDOW_RC_DAYS + 2) * MS_DAY).toISOString().slice(0, 10);
  const [awards, partners, dismissedBiz, touches] = await Promise.all([
    fetchAllPages<AwardRow>((a, b) =>
      sb
        .from("construction_project")
        .select(
          "id, title, ordering_org, stage_date, est_amount, awarded_company, awardee_bizno, linked_partner_id, tel:raw->>bidwinnrTelNo, addr:raw->>bidwinnrAdrs, ceo:raw->>bidwinnrCeoNm, cnstwk:raw->>mtltyAdvcPsblYnCnstwkNm",
        )
        .eq("source", "nara_bid")
        .eq("stage", "awarded")
        .is("deleted_at", null)
        .is("dismissed_at", null)
        .gte("stage_date", since)
        .order("stage_date", { ascending: false })
        .order("id")
        .range(a, b) as unknown as Res<AwardRow>,
    ),
    fetchAllPages<{ id: string; name: string; business_no: string | null }>((a, b) =>
      sb.from("partner").select("id, name, business_no").is("deleted_at", null).order("id").range(a, b) as unknown as Res<{ id: string; name: string; business_no: string | null }>,
    ),
    // [제외]는 계정(사업자번호) 전체 — 제외 뒤 새로 들어온 낙찰 행도 숨긴다.
    // soft delete 여부와 무관(제외는 사람의 결정 — 정리 스크립트가 행을 지워도 수신거부는 유지).
    fetchAllPages<{ awardee_bizno: string | null }>((a, b) =>
      sb
        .from("construction_project")
        .select("awardee_bizno")
        .not("dismissed_at", "is", null)
        .not("awardee_bizno", "is", null)
        .order("id")
        .range(a, b) as unknown as Res<{ awardee_bizno: string | null }>,
    ),
    loadNaraTouches(sb),
  ]);
  const partnerByBizno = new Map<string, string>();
  for (const p of partners) {
    const d = digits(p.business_no);
    if (d.length === 10) partnerByBizno.set(d, p.name);
  }
  const partnerById = new Map(partners.map((p) => [p.id, p.name]));
  const hidden = new Set(dismissedBiz.map((r) => r.awardee_bizno!).filter(Boolean));
  // 영업내역 기록으로도 숨김 — 거절은 이력 어디든, 연락 불가는 최신 기록일 때(CSV 수기 기록: 연결·제외 처리 전에도 즉시)
  for (const [key, ts] of touches) if (hiddenByTouches(ts)) hidden.add(key);

  const byKey = new Map<string, PhoneAccount>();
  const masked = new Set<string>();
  for (const r of awards) {
    const key = r.awardee_bizno ?? r.id; // 사업자번호 없으면 행 단위(회사명으로 묶지 않음)
    if (hidden.has(key)) continue;
    const input = {
      source: "nara_bid" as const,
      stage: "awarded" as const,
      stage_date: r.stage_date,
      title: r.title,
      cnstwk_type: r.cnstwk,
      awarded_company: r.awarded_company,
      awardee_tel: r.tel,
      awardee_addr: r.addr,
    };
    const m = phoneRuleMatch(input, today);
    if (!m) {
      if (!telValid(r.tel) && phoneRuleMatch({ ...input, awardee_tel: "0540000000" }, today)) masked.add(key);
      continue;
    }
    let acc = byKey.get(key);
    if (!acc) {
      const missing: string[] = [];
      if (!r.awarded_company) missing.push("낙찰사명");
      if (!r.ceo) missing.push("대표");
      if (!telValid(r.tel)) missing.push("전화");
      if (!r.awardee_bizno) missing.push("사업자번호");
      if (!(r.addr ?? "").trim()) missing.push("소재지");
      acc = {
        bizno: key,
        company: r.awarded_company,
        ceo: r.ceo,
        tel: r.tel,
        addr: r.addr,
        match: m,
        partnerName:
          (r.linked_partner_id ? partnerById.get(r.linked_partner_id) : undefined) ??
          (r.awardee_bizno ? partnerByBizno.get(r.awardee_bizno) : undefined) ??
          null,
        awards: [],
        missing,
        lastTouch: (() => {
          const ts = touches.get(key);
          if (!ts || ts.length === 0) return null;
          const last = ts.reduce((x, y) => (x.created_at >= y.created_at ? x : y));
          return { contacted_on: last.contacted_on, result: normalizeResultCode(last.result) ?? last.result };
        })(),
      };
      byKey.set(key, acc);
    } else if (acc.match !== m) {
      acc.match = "both";
    }
    acc.awards.push({
      id: r.id,
      title: r.title,
      ordering_org: r.ordering_org,
      stage_date: r.stage_date,
      est_amount: r.est_amount,
      rc: naraLabelOf(r.title, r.cnstwk) === "rc",
    });
    if (!acc.partnerName && r.linked_partner_id) acc.partnerName = partnerById.get(r.linked_partner_id) ?? null;
  }
  for (const k of byKey.keys()) masked.delete(k); // 다른 낙찰로 이미 걸 수 있는 계정은 마스킹 집계에서 뺀다
  const rank = (a: PhoneAccount) => (a.partnerName ? 0 : 2) + (a.match === "local" ? 1 : 0);
  const accounts = [...byKey.values()].sort(
    (a, b) => rank(a) - rank(b) || (b.awards[0]?.stage_date ?? "").localeCompare(a.awards[0]?.stage_date ?? ""),
  );
  return {
    accounts,
    maskedInWindow: masked.size,
    partnersWithBizno: partnerByBizno.size,
    partnersTotal: partners.length,
  };
}

// ── 동기화 시각 ───────────────────────────────────────────────
/** 소스별 마지막 수집 시각 = max(last_seen_at). 수집기만 쓰는 컬럼이라 [제외]·정리 스크립트에 흔들리지 않는다(0070). */
export async function lastSeenBySource(sb: SupabaseClient): Promise<{ building: string | null; nara: string | null }> {
  const one = async (source: string) => {
    const { data, error } = await sb
      .from("construction_project")
      .select("last_seen_at")
      .eq("source", source)
      .is("deleted_at", null)
      .not("last_seen_at", "is", null)
      .order("last_seen_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`동기화 시각 조회 실패: ${error.message}`);
    return (data?.[0] as { last_seen_at: string } | undefined)?.last_seen_at ?? null;
  };
  const [building, nara] = await Promise.all([one("building_permit"), one("nara_bid")]);
  return { building, nara };
}

// ── 수기 기록 연결(쓰기) ──────────────────────────────────────

export interface LinkResult {
  found: number; // 메모에서 레이더 id 를 찾은 기록
  linked: number;
  dismissed: number; // 제외 결과(거절·현장 없음)로 제외 처리한 레이더 행
  failed: Array<{ log_id: string; reason: string }>;
  noId: number; // '레이더'는 있는데 id 가 없는 메모
}

/**
 * 영업내역 페이지에서 수기로 남긴 기록(메모에 "레이더 {id}")을 sales_log.project_id 로 연결 — 멱등.
 * 결과가 '거절'·'현장 없음'(정규화)이면 radar_touch 와 같은 범위로 제외 처리(사업자번호 있으면 계정 전체,
 * '철근 안 씀·거절'은 기존 복구 가능 사유도 영구로 승격). 제외가 실패하면 연결하지 않아 다음 실행에서 재시도.
 * D0 CSV 콜 캠페인 기록이 D10 판정·수신거부에 들어오게 한다. 수집 cron 이 매일 호출(service_role).
 */
export async function linkSalesLogNotes(sb: SupabaseClient, opts: { dryRun?: boolean } = {}): Promise<LinkResult> {
  const logs = await fetchAllPages<{ id: string; notes: string | null; result: string | null }>((a, b) =>
    sb
      .from("sales_log")
      .select("id, notes, result")
      .is("project_id", null)
      .is("deleted_at", null)
      .ilike("notes", "%레이더%")
      .order("id")
      .range(a, b) as unknown as Res<{ id: string; notes: string | null; result: string | null }>,
  );
  const res: LinkResult = { found: 0, linked: 0, dismissed: 0, failed: [], noId: 0 };
  for (const l of logs) {
    const pid = extractRadarId(l.notes);
    if (!pid) {
      res.noId += 1;
      continue;
    }
    res.found += 1;
    if (opts.dryRun) continue;
    const { data: proj, error: pe } = await sb
      .from("construction_project")
      .select("id, awardee_bizno, dismiss_reason")
      .eq("id", pid)
      .maybeSingle();
    if (pe || !proj) {
      res.failed.push({ log_id: l.id, reason: pe?.message ?? `레이더 행 없음(${pid})` });
      continue;
    }
    const code = normalizeResultCode(l.result);
    if (code && isDismissResult(code)) {
      const patch = { dismissed_at: new Date().toISOString(), dismiss_reason: code };
      let q = sb.from("construction_project").update(patch);
      q = proj.awardee_bizno ? q.eq("awardee_bizno", proj.awardee_bizno) : q.eq("id", proj.id);
      // 미제외 행 + ('거절'이면) 복구 가능 사유로 제외된 행도 영구로 승격
      q = code === RESULT_REFUSED
        ? q.or(`dismissed_at.is.null,dismiss_reason.is.null,dismiss_reason.neq."${RESULT_REFUSED}"`)
        : q.is("dismissed_at", null);
      const { data: changed, error: de } = await q.select("id");
      if (de) {
        res.failed.push({ log_id: l.id, reason: `제외 실패: ${de.message}` });
        continue; // 연결하지 않음 → 다음 실행에서 재시도
      }
      res.dismissed += changed?.length ?? 0;
    }
    const { error } = await sb.from("sales_log").update({ project_id: pid }).eq("id", l.id).is("project_id", null);
    if (error) res.failed.push({ log_id: l.id, reason: error.message });
    else res.linked += 1;
  }

  // 조정 패스 — 이미 연결된 기록의 결과를 영업내역에서 '거절'로 고친 경우도 영구 제외로(멱등).
  // (연락 불가는 [복구]를 존중해 연결 시점에만 적용)
  if (!opts.dryRun) {
    const linked = await fetchAllPages<{ id: string; result: string | null; project_id: string }>((a, b) =>
      sb
        .from("sales_log")
        .select("id, result, project_id")
        .not("project_id", "is", null)
        .is("deleted_at", null)
        .order("id")
        .range(a, b) as unknown as Res<{ id: string; result: string | null; project_id: string }>,
    );
    const refusedPids = [...new Set(linked.filter((l) => normalizeResultCode(l.result) === RESULT_REFUSED).map((l) => l.project_id))];
    for (const ids of chunks(refusedPids, IN_CHUNK)) {
      const { data: projs, error: pe } = await sb.from("construction_project").select("id, awardee_bizno, dismiss_reason").in("id", ids);
      if (pe) {
        res.failed.push({ log_id: "-", reason: `조정 조회 실패: ${pe.message}` });
        continue;
      }
      for (const p of (projs ?? []) as Array<{ id: string; awardee_bizno: string | null; dismiss_reason: string | null }>) {
        let q = sb.from("construction_project").update({ dismissed_at: new Date().toISOString(), dismiss_reason: RESULT_REFUSED });
        q = p.awardee_bizno ? q.eq("awardee_bizno", p.awardee_bizno) : q.eq("id", p.id);
        const { data: changed, error } = await q
          .or(`dismissed_at.is.null,dismiss_reason.is.null,dismiss_reason.neq."${RESULT_REFUSED}"`)
          .select("id");
        if (error) res.failed.push({ log_id: "-", reason: `조정 실패(${p.id}): ${error.message}` });
        else res.dismissed += changed?.length ?? 0;
      }
    }
  }
  return res;
}

/** (읽기) '레이더' 메모 중 계정에 연결할 수 없는 기록 — CSV 내보내기 직전 경고용. */
export async function findUnmappedRadarNotes(
  sb: SupabaseClient,
): Promise<Array<{ log_id: string; contacted_on: string; prospect_name: string | null; result: string | null; reason: string }>> {
  type N = { id: string; notes: string | null; result: string | null; contacted_on: string; prospect_name: string | null };
  const logs = await fetchAllPages<N>((a, b) =>
    sb
      .from("sales_log")
      .select("id, notes, result, contacted_on, prospect_name")
      .is("project_id", null)
      .is("deleted_at", null)
      .ilike("notes", "%레이더%")
      .order("id")
      .range(a, b) as unknown as Res<N>,
  );
  const withId = logs.map((l) => ({ l, pid: extractRadarId(l.notes) }));
  const ids = [...new Set(withId.map((x) => x.pid).filter((x): x is string => !!x))];
  const known = new Set<string>();
  for (const part of chunks(ids, IN_CHUNK)) {
    const { data, error } = await sb.from("construction_project").select("id").in("id", part);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ id: string }>) known.add(r.id);
  }
  return withId
    .filter((x) => !x.pid || !known.has(x.pid))
    .map((x) => ({
      log_id: x.l.id,
      contacted_on: x.l.contacted_on,
      prospect_name: x.l.prospect_name,
      result: x.l.result,
      reason: x.pid ? `레이더 행 없음(${x.pid})` : "메모에 레이더 id 없음",
    }));
}

// ── 거래처 연결(★) ────────────────────────────────────────────

/**
 * 사업자번호가 같은 거래처를 레이더 낙찰 행에 연결(linked_partner_id) — 멱등, 미연결 행만.
 * 수집 cron·정리 스크립트·거래처 저장 시 호출. bizno 를 주면 그 사업자번호만.
 */
export async function linkPartnersByBizno(
  sb: SupabaseClient,
  opts: { bizno?: string | null; dryRun?: boolean } = {},
): Promise<{ partners: number; linked: number }> {
  const only = opts.bizno ? digits(opts.bizno) : null;
  if (opts.bizno !== undefined && (!only || only.length !== 10)) return { partners: 0, linked: 0 };
  if (opts.bizno === undefined) {
    // 전체 동기화 — 삭제된 거래처에 걸린 ★ 부터 푼다(같은 번호의 다른 거래처가 아래에서 다시 잡도록).
    const { data: gone, error: ge } = await sb.from("partner").select("id").not("deleted_at", "is", null);
    if (ge) throw new Error(`삭제 거래처 조회 실패: ${ge.message}`);
    const goneIds = ((gone ?? []) as Array<{ id: string }>).map((g) => g.id);
    for (const part of chunks(goneIds, IN_CHUNK)) {
      if (opts.dryRun) continue;
      const { error: ue } = await sb.from("construction_project").update({ linked_partner_id: null }).in("linked_partner_id", part);
      if (ue) throw new Error(`삭제 거래처 ★ 해제 실패: ${ue.message}`);
    }
  }
  let q = sb.from("partner").select("id, business_no, created_at").is("deleted_at", null).not("business_no", "is", null);
  if (only) q = q.eq("business_no", only);
  const { data, error } = await q.order("created_at");
  if (error) throw new Error(`거래처 조회 실패: ${error.message}`);
  const byBizno = new Map<string, string>(); // 같은 번호 중복 거래처면 가장 먼저 만든 것
  for (const p of (data ?? []) as Array<{ id: string; business_no: string | null }>) {
    const d = digits(p.business_no);
    if (d.length === 10 && !byBizno.has(d)) byBizno.set(d, p.id);
  }
  let linked = 0;
  for (const [bizno, pid] of byBizno) {
    if (opts.dryRun) {
      const { count } = await sb
        .from("construction_project")
        .select("id", { count: "exact", head: true })
        .eq("awardee_bizno", bizno)
        .is("linked_partner_id", null);
      linked += count ?? 0;
      continue;
    }
    const { data: changed, error: e2 } = await sb
      .from("construction_project")
      .update({ linked_partner_id: pid })
      .eq("awardee_bizno", bizno)
      .is("linked_partner_id", null)
      .select("id");
    if (e2) throw new Error(`★ 연결 실패(${bizno}): ${e2.message}`);
    linked += changed?.length ?? 0;
  }
  return { partners: byBizno.size, linked };
}

/**
 * [거래처로]·[기존 거래처에 연결] — 그 레이더 행(낙찰이면 같은 사업자번호 계정 전체)을 거래처에 연결.
 * 미연결 행만(다른 사용자가 건 ★를 덮지 않음). 실패는 error 로 돌려준다.
 */
export async function linkRadarRowToPartner(
  sb: SupabaseClient,
  projectId: string,
  partnerId: string,
): Promise<{ linked: number; error: string | null }> {
  const { data: proj, error } = await sb
    .from("construction_project")
    .select("id, awardee_bizno, linked_partner_id, linked_partner:partner!construction_project_linked_partner_id_fkey(name, deleted_at)")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return { linked: 0, error: error.message };
  if (!proj) return { linked: 0, error: "레이더 행을 찾지 못했습니다." };
  const cur = proj.linked_partner as unknown as { name: string; deleted_at: string | null } | null;
  if (proj.linked_partner_id && proj.linked_partner_id !== partnerId && cur && !cur.deleted_at) {
    return { linked: 0, error: `이 레이더 행은 이미 다른 거래처(${cur.name})에 연결돼 있습니다.` };
  }
  if (proj.linked_partner_id && proj.linked_partner_id !== partnerId) {
    // 삭제된 거래처에 걸린 ★ — 풀고 새로 연결
    await sb.from("construction_project").update({ linked_partner_id: null }).eq("linked_partner_id", proj.linked_partner_id);
  }
  let q = sb.from("construction_project").update({ linked_partner_id: partnerId });
  q = proj.awardee_bizno ? q.eq("awardee_bizno", proj.awardee_bizno) : q.eq("id", proj.id);
  const { data: changed, error: e2 } = await q.is("linked_partner_id", null).select("id");
  if (e2) return { linked: 0, error: e2.message };
  return { linked: changed?.length ?? 0, error: null };
}

/**
 * 거래처 삭제·사업자번호 변경 시 ★ 정리 — 그 거래처에 걸린 연결을 푼다(bizno 를 주면 그 번호 행만).
 * 그 뒤 호출부가 linkPartnersByBizno 로 같은 번호의 다른 거래처에 다시 연결한다.
 */
export async function unlinkRadarPartner(sb: SupabaseClient, partnerId: string, onlyBizno?: string | null): Promise<number> {
  let q = sb.from("construction_project").update({ linked_partner_id: null }).eq("linked_partner_id", partnerId);
  if (onlyBizno) q = q.eq("awardee_bizno", onlyBizno);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`★ 해제 실패: ${error.message}`);
  return data?.length ?? 0;
}

// ── 문자(MMS) 가드 ────────────────────────────────────────────

/**
 * 동의 = 결과가 정확히 '견적 요청'(공백·가운뎃점 무시, 뒤에 붙은 괄호 메모 허용 — 예: "견적 요청(박 소장)").
 * 자유 텍스트의 '견적 필요 없음'·'견적서 발송'·'견적 요청했다가 거절' 등은 동의가 아니다.
 */
export function isExactQuoteRequest(result: string | null | undefined): boolean {
  const s = String(result ?? "").replace(/[(\[（【][\s\S]*$/, "").replace(/[\s·ㆍ.・]/g, "");
  return s === "견적요청";
}

/** 문자 가드용 거절 판정 — 정규화 코드보다 보수적으로(자유 텍스트의 거절·거부·필요 없음 등도 거절로 본다). */
const REFUSAL_LIKE = /거절|거부|사절|안\s*씀|안\s*써|필요\s*없|수신\s*거부|연락\s*(하지|말)/;
export function isRefusalForMms(result: string | null | undefined): boolean {
  return normalizeResultCode(result) === RESULT_REFUSED || REFUSAL_LIKE.test(String(result ?? ""));
}

type Consent = { ok: true } | { ok: false; reason: string };

type ConsentRow = { id: string; dismiss_reason: string | null };

/**
 * 레이더 행 묶음(행·계정·★ 행)에 대한 문자 동의 판정 — 거절이 하나라도 있으면 차단.
 * requireRequest(기본 true)면 '견적 요청' 기록도 있어야 허용 — 끄면 거절만 본다(레이더 이전부터 있던 거래처).
 * partnerIds 를 주면 영업내역에서 그 거래처를 골라 남긴 기록(레이더 연결 없음)도 함께 본다.
 */
async function consentForRows(
  sb: SupabaseClient,
  rows: ConsentRow[],
  opts: { requireRequest?: boolean; partnerIds?: Array<string | null | undefined> } = {},
): Promise<Consent> {
  if (rows.some((r) => r.dismiss_reason === RESULT_REFUSED)) {
    return { ok: false, reason: "이 업체는 '철근 안 씀·거절'(수신거부)로 제외돼 문자를 보낼 수 없습니다." };
  }
  const ids = rows.map((r) => r.id);
  const results: Array<string | null> = [];
  for (const part of chunks(ids, IN_CHUNK)) {
    const { data, error } = await sb.from("sales_log").select("result").in("project_id", part).is("deleted_at", null);
    if (error) return { ok: false, reason: `영업내역 조회 실패: ${error.message}` };
    for (const l of (data ?? []) as Array<{ result: string | null }>) results.push(l.result);
  }
  const partnerIds = [...new Set((opts.partnerIds ?? []).filter((x): x is string => !!x))];
  for (const part of chunks(partnerIds, IN_CHUNK)) {
    const { data, error } = await sb.from("sales_log").select("result").in("partner_id", part).is("deleted_at", null);
    if (error) return { ok: false, reason: `영업내역 조회 실패: ${error.message}` };
    for (const l of (data ?? []) as Array<{ result: string | null }>) results.push(l.result);
  }
  // 미연결 기록 — radar_touch(0072)와 같은 범위: 메모 어디든 행 id 가 들어 있으면('레이더' 글자 없어도) 본다.
  let noted: Array<{ result: string | null; notes: string | null }>;
  try {
    noted = await fetchAllPages<{ result: string | null; notes: string | null }>((a, b) =>
      sb
        .from("sales_log")
        .select("result, notes")
        .is("project_id", null)
        .is("deleted_at", null)
        .filter("notes", "imatch", "[0-9a-f]{8}-[0-9a-f]{4}-")
        .order("id")
        .range(a, b) as unknown as Res<{ result: string | null; notes: string | null }>,
    );
  } catch (e) {
    return { ok: false, reason: `영업내역 조회 실패: ${(e as Error).message}` };
  }
  for (const l of noted) {
    const n = (l.notes ?? "").toLowerCase();
    if (ids.some((id) => n.includes(id))) results.push(l.result);
  }
  if (results.some(isRefusalForMms)) {
    return {
      ok: false,
      reason:
        "영업내역에 거절·거부(수신거부)로 읽히는 기록이 있어 문자를 보낼 수 없습니다. 번복된 기록이면 그 기록의 결과 문구를 고치세요.",
    };
  }
  if ((opts.requireRequest ?? true) && !results.some(isExactQuoteRequest)) {
    return {
      ok: false,
      reason:
        "레이더에서 나온 상대에게는 견적을 요청한 기록('견적 요청')이 있어야 문자를 보낼 수 있습니다(수신자 요청 원칙). 먼저 통화·방문 결과를 '견적 요청'으로 기록하세요.",
    };
  }
  return { ok: true };
}

/** 레이더 행과, 낙찰이면 같은 사업자번호 계정의 행 전체. */
async function accountRows(sb: SupabaseClient, projectId: string): Promise<{ rows: ConsentRow[] } | { error: string }> {
  const { data: proj, error } = await sb
    .from("construction_project")
    .select("id, awardee_bizno, dismiss_reason")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return { error: `레이더 행 조회 실패: ${error.message}` };
  if (!proj) return { error: "출처 레이더 행을 찾지 못했습니다." };
  if (!proj.awardee_bizno) return { rows: [{ id: proj.id, dismiss_reason: proj.dismiss_reason }] };
  const { data: acc, error: e2 } = await sb.from("construction_project").select("id, dismiss_reason").eq("awardee_bizno", proj.awardee_bizno);
  if (e2) return { error: `계정 조회 실패: ${e2.message}` };
  return { rows: (acc ?? []) as ConsentRow[] };
}

/**
 * 레이더 발 견적의 문자 발송 동의 — 그 행 또는 같은 계정(사업자번호)에 '견적 요청' 기록이 있고 '거절'이 없어야 한다.
 * (수신자가 요청한 견적만 문자로 보낸다 — 정보통신망법 §50 취지, 기획안 §6·§12. 법률 자문 아님)
 */
export async function radarQuoteConsent(sb: SupabaseClient, projectId: string, partnerId: string | null = null): Promise<Consent> {
  const acc = await accountRows(sb, projectId);
  if ("error" in acc) return { ok: false, reason: acc.error };
  return consentForRows(sb, acc.rows, { partnerIds: [partnerId] });
}

/**
 * 견적서 문자(MMS) 발송 동의 — 발주 레이더에서 나온 상대에게는 '견적 요청' 기록이 있어야 보낸다.
 * 견적·거래처 기준(quoteSideConsent)과 받는 번호 기준(recipientPhoneConsent)을 모두 통과해야 한다.
 */
export async function quoteMmsConsent(
  sb: SupabaseClient,
  q: { sourceProjectId: string | null; partnerId: string | null; toPhone?: string | null },
): Promise<Consent> {
  const byQuote = await quoteSideConsent(sb, q);
  if (!byQuote.ok) return byQuote;
  return q.toPhone ? recipientPhoneConsent(sb, q.toPhone) : { ok: true };
}

/**
 * 견적·거래처 기준 동의.
 *  - 견적 거래처에 매출 이력이 있으면(거래관계) 통과.
 *  - 레이더 출처 = 견적의 source_project_id(레이더 카드·영업내역 [견적]) → 그 행·계정 기준.
 *  - 출처가 없어도 거래처를 [거래처로]로 레이더에서 만들었으면(partner.source_project_id, 0074)
 *    그 출처 행·계정 + ★ 연결 행 기준(견적 메뉴에서 만든 견적). ★ 연결이 풀려도 출처는 남는다.
 *  - 출처 없는 ★ 거래처는 등록 시각으로 가른다(preRadarPartner): 캠페인 시작 전에, 그리고 ★ 행이 처음 수집되기 전에
 *    등록된 거래처만 '레이더 이전부터'로 보고 거절 기록만 막는다. 그 밖(전화 캠페인 뒤 거래처 메뉴 등록, 명함 등록 뒤
 *    [거래처로] 연결, 캠페인 중 등록 등)은 레이더에서 온 상대로 보고 '견적 요청'을 요구한다.
 *  - 거래처가 있으면 영업내역에서 그 거래처를 골라 남긴 기록도 본다(거절이면 차단, '견적 요청'이면 동의).
 *  - 그 밖(레이더와 무관한 견적)은 통과.
 */
async function quoteSideConsent(
  sb: SupabaseClient,
  q: { sourceProjectId: string | null; partnerId: string | null },
): Promise<Consent> {
  if (q.partnerId) {
    const { count, error } = await sb
      .from("sale")
      .select("id", { count: "exact", head: true })
      .eq("partner_id", q.partnerId)
      .is("deleted_at", null);
    if (error) return { ok: false, reason: `매출 이력 조회 실패: ${error.message}` };
    if ((count ?? 0) > 0) return { ok: true };
  }
  if (q.sourceProjectId) return radarQuoteConsent(sb, q.sourceProjectId, q.partnerId);
  if (!q.partnerId) return { ok: true };
  const { data: partner, error: pe } = await sb
    .from("partner")
    .select("source_project_id, created_at")
    .eq("id", q.partnerId)
    .maybeSingle();
  if (pe) return { ok: false, reason: `거래처 조회 실패: ${pe.message}` };
  const { data: linked, error } = await sb
    .from("construction_project")
    .select("id, dismiss_reason, created_at")
    .eq("linked_partner_id", q.partnerId);
  if (error) return { ok: false, reason: `레이더 연결 조회 실패: ${error.message}` };
  const starred = (linked ?? []) as Array<ConsentRow & { created_at: string | null }>;
  const fromRadar = (partner?.source_project_id as string | null | undefined) ?? null;
  if (fromRadar) {
    const acc = await accountRows(sb, fromRadar);
    if ("error" in acc) return { ok: false, reason: acc.error };
    const rows: ConsentRow[] = [...starred];
    const seen = new Set(rows.map((r) => r.id));
    for (const r of acc.rows) if (!seen.has(r.id)) rows.push(r);
    return consentForRows(sb, rows, { partnerIds: [q.partnerId] });
  }
  if (starred.length === 0) return { ok: true };
  const preRadar = preRadarPartner(partner?.created_at as string | null | undefined, starred.map((r) => r.created_at));
  return consentForRows(sb, starred, { requireRequest: !preRadar, partnerIds: [q.partnerId] });
}

type PhoneRow = ConsentRow & { created_at: string | null; linked_partner_id: string | null; awardee_bizno: string | null };
const PHONE_ROW_COLS = "id, dismiss_reason, created_at, linked_partner_id, awardee_bizno";

/**
 * 받는 번호를 발주 레이더가 보여준 행 — 낙찰사 전화(raw.bidwinnrTelNo, 마스킹 제외)·방문 기록 담당자 전화
 * (sales_log.contact_phone, 레이더에 연결된 기록만), 그리고 같은 사업자번호 계정의 행 전체(동의·거절은 계정 단위).
 * 끝 4자리로 후보를 좁힌 뒤 숫자로 비교한다(phoneMatches — 형식 무시, 한 칸에 여러 번호·내선을 적은 값은 포함 여부).
 * 레이더가 번호를 새로 얻는 곳이 생기면(예: 키스콘으로 마스킹 번호 채우기) 그 번호도 여기서 찾아야 한다.
 */
async function radarRowsByPhone(sb: SupabaseClient, phone: string): Promise<{ rows: PhoneRow[] } | { error: string }> {
  const d = phoneKey(phone);
  if (!d) return { rows: [] };
  const tail = `%${d.slice(-4)}%`;
  const byId = new Map<string, PhoneRow>();
  try {
    const awards = await fetchAllPages<PhoneRow & { tel: string | null }>((a, b) =>
      sb
        .from("construction_project")
        .select(`${PHONE_ROW_COLS}, tel:raw->>bidwinnrTelNo`)
        .eq("source", "nara_bid")
        .ilike("raw->>bidwinnrTelNo", tail)
        .order("id")
        .range(a, b) as unknown as Res<PhoneRow & { tel: string | null }>,
    );
    for (const r of awards) if (phoneMatches(r.tel, d)) byId.set(r.id, r);
    const logs = await fetchAllPages<{ project_id: string | null; notes: string | null; contact_phone: string | null }>((a, b) =>
      sb
        .from("sales_log")
        .select("project_id, notes, contact_phone")
        .is("deleted_at", null)
        .ilike("contact_phone", tail)
        .order("id")
        .range(a, b) as unknown as Res<{ project_id: string | null; notes: string | null; contact_phone: string | null }>,
    );
    const ids = new Set<string>();
    for (const l of logs) {
      if (!phoneMatches(l.contact_phone, d)) continue;
      const pid = l.project_id ?? extractRadarId(l.notes);
      if (pid && !byId.has(pid)) ids.add(pid);
    }
    for (const part of chunks([...ids], IN_CHUNK)) {
      const { data, error } = await sb.from("construction_project").select(PHONE_ROW_COLS).in("id", part);
      if (error) return { error: `레이더 행 조회 실패: ${error.message}` };
      for (const r of (data ?? []) as PhoneRow[]) byId.set(r.id, r);
    }
    const biznos = [...new Set([...byId.values()].map((r) => r.awardee_bizno).filter((x): x is string => !!x))];
    for (const part of chunks(biznos, IN_CHUNK)) {
      const { data, error } = await sb.from("construction_project").select(PHONE_ROW_COLS).in("awardee_bizno", part);
      if (error) return { error: `계정 조회 실패: ${error.message}` };
      for (const r of (data ?? []) as PhoneRow[]) byId.set(r.id, r);
    }
  } catch (e) {
    return { error: `레이더 번호 조회 실패: ${(e as Error).message}` };
  }
  return { rows: [...byId.values()] };
}

/**
 * 받는 번호 기준 동의 — 레이더가 보여준 번호(낙찰사 전화·방문 기록 담당자 전화)로 보내는 견적 문자는 견적 출처·거래처와
 * 무관하게 그 번호의 레이더 행·계정으로 판정한다(잠재 거래처명만 넣은 견적, 사업자번호 없이 등록한 거래처, 다른 거래처 견적에
 * 레이더 번호를 넣은 경우 포함). 레이더에 없는 번호는 통과.
 *  - 이 번호를 쓰는 거래처(전화가 같은 거래처, 그 행에 ★ 연결된 거래처) 중 매출 이력이 있으면 통과(거래관계).
 *  - 그 행에 ★ 연결된 거래처가 레이더 이전 거래처(출처 없음 + 그 거래처의 ★ 행 전체로 preRadarPartner)면 거절 기록만 막는다.
 *  - 그 밖은 그 행·계정, 또는 이 번호를 쓰는 거래처를 골라 남긴 영업내역에 '견적 요청'이 있어야 보낸다. 거절이면 막는다.
 */
export async function recipientPhoneConsent(sb: SupabaseClient, toPhone: string): Promise<Consent> {
  const found = await radarRowsByPhone(sb, toPhone);
  if ("error" in found) return { ok: false, reason: found.error };
  const rows = found.rows;
  const d = phoneKey(toPhone);
  if (rows.length === 0 || !d) return { ok: true };
  type Holder = { id: string; created_at: string; source_project_id: string | null; starred: boolean };
  const holders = new Map<string, Holder>();
  const { data: byPhone, error: pe } = await sb
    .from("partner")
    .select("id, phone, created_at, source_project_id")
    .ilike("phone", `%${d.slice(-4)}%`);
  if (pe) return { ok: false, reason: `거래처 조회 실패: ${pe.message}` };
  for (const p of (byPhone ?? []) as Array<Omit<Holder, "starred"> & { phone: string | null }>) {
    if (phoneMatches(p.phone, d)) holders.set(p.id, { id: p.id, created_at: p.created_at, source_project_id: p.source_project_id, starred: false });
  }
  const starIds = [...new Set(rows.map((r) => r.linked_partner_id).filter((x): x is string => !!x))];
  for (const part of chunks(starIds, IN_CHUNK)) {
    const { data, error } = await sb.from("partner").select("id, created_at, source_project_id").in("id", part);
    if (error) return { ok: false, reason: `거래처 조회 실패: ${error.message}` };
    for (const p of (data ?? []) as Array<Omit<Holder, "starred">>) holders.set(p.id, { ...p, starred: true });
  }
  const holderIds = [...holders.keys()];
  for (const part of chunks(holderIds, IN_CHUNK)) {
    const { count, error } = await sb
      .from("sale")
      .select("id", { count: "exact", head: true })
      .in("partner_id", part)
      .is("deleted_at", null);
    if (error) return { ok: false, reason: `매출 이력 조회 실패: ${error.message}` };
    if ((count ?? 0) > 0) return { ok: true };
  }
  // 레이더 이전 판정은 견적·거래처 기준과 같은 입력 — 그 거래처의 ★ 행 전체(이 번호로 찾은 행만이 아니라)
  const starredAt = new Map<string, Array<string | null>>();
  try {
    for (const part of chunks(starIds, IN_CHUNK)) {
      const linked = await fetchAllPages<{ linked_partner_id: string; created_at: string | null }>((a, b) =>
        sb
          .from("construction_project")
          .select("linked_partner_id, created_at")
          .in("linked_partner_id", part)
          .order("id")
          .range(a, b) as unknown as Res<{ linked_partner_id: string; created_at: string | null }>,
      );
      for (const r of linked) starredAt.set(r.linked_partner_id, [...(starredAt.get(r.linked_partner_id) ?? []), r.created_at]);
    }
  } catch (e) {
    return { ok: false, reason: `레이더 연결 조회 실패: ${(e as Error).message}` };
  }
  const preRadar = [...holders.values()].some(
    (h) => h.starred && !h.source_project_id && preRadarPartner(h.created_at, starredAt.get(h.id) ?? []),
  );
  const r = await consentForRows(sb, rows, { requireRequest: !preRadar, partnerIds: holderIds });
  if (r.ok) return r;
  return { ok: false, reason: `받는 번호(${formatPhone(d)})는 발주 레이더에서 나온 번호입니다(낙찰사 전화·방문 기록). ${r.reason}` };
}
