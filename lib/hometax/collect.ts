/**
 * 홈택스 수집 오케스트레이터 — 한 책·한 방향·한 기간을 팝빌에 요청해 hometax_invoice 에 upsert 하고 작업 이력을 남긴다.
 * 호출처: scripts/hometax-collect.ts(크론, 서비스 롤) · app/[book]/hometax/actions.ts([지금 수집], 로그인 사용자 — RLS staff).
 * 수집 컬럼만 upsert 하므로 대사 컬럼(match_status·sale_id…)은 건드리지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book } from "@/lib/book";
import { digitsOnly } from "@/lib/format";
import { friendlyHometaxError, normalizeInvoice, toPopbillDate } from "./normalize";
import { htGetTaxinvoice, htRequestJob, htSearchAll, htWaitJob } from "./popbill-ht";
import { HOMETAX_DIRECTIONS, type HometaxDateType, type HometaxDirection, type HometaxInvoiceInsert } from "./types";

export type CollectInput = {
  book: Book;
  direction: HometaxDirection;
  dateType?: HometaxDateType; // 기본 S(전송일)
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  source: "cron" | "manual";
  requestedBy?: string | null;
  /** 새 행의 상세(품목)까지 받을지. 기본 true — 정액제라 비용 없음. */
  fetchDetails?: boolean;
  log?: (msg: string) => void;
};

export type CollectResult =
  | { ok: true; jobId: string; found: number; inserted: number; updated: number }
  | { ok: false; error: string };

/** 책의 사업자번호(숫자만) — company_profile. */
export async function corpNumForBook(sb: SupabaseClient, book: Book): Promise<string> {
  const { data, error } = await sb.from("company_profile").select("business_no").eq("book", book).maybeSingle();
  if (error) throw new Error(`회사정보 조회 실패: ${error.message}`);
  const corp = digitsOnly(data?.business_no);
  if (corp.length !== 10) throw new Error(`${book} 책의 사업자등록번호가 회사정보에 없거나 형식이 다릅니다.`);
  return corp;
}

export async function collectHometax(sb: SupabaseClient, input: CollectInput): Promise<CollectResult> {
  const log = input.log ?? (() => {});
  const dateType = input.dateType ?? "S";
  if (input.book === "b") return { ok: false, error: "B계좌 책은 계산서 수집 대상이 아닙니다." };
  if (input.from > input.to) return { ok: false, error: "시작일이 종료일보다 늦습니다." };

  const { data: job, error: jobErr } = await sb
    .from("hometax_collection_job")
    .insert({
      book: input.book,
      direction: input.direction,
      date_type: dateType,
      from_date: input.from,
      to_date: input.to,
      state: "requested",
      source: input.source,
      requested_by: input.requestedBy ?? null,
    })
    .select("id")
    .single();
  if (jobErr || !job) return { ok: false, error: `수집 이력 저장 실패: ${jobErr?.message ?? "?"}` };

  const fail = async (message: string): Promise<CollectResult> => {
    const friendly = friendlyHometaxError(message);
    await sb.from("hometax_collection_job").update({ state: "failed", error: friendly, finished_at: new Date().toISOString() }).eq("id", job.id);
    return { ok: false, error: friendly };
  };

  try {
    const corp = await corpNumForBook(sb, input.book);
    const queryType = HOMETAX_DIRECTIONS.find((d) => d.value === input.direction)!.popbill;
    const jobId = await htRequestJob(corp, queryType, dateType, toPopbillDate(input.from), toPopbillDate(input.to));
    await sb.from("hometax_collection_job").update({ job_id: jobId, state: "running" }).eq("id", job.id);
    log(`${input.book}/${input.direction} 요청 ${jobId} (${dateType} ${input.from}~${input.to})`);

    await htWaitJob(corp, jobId);
    const list = await htSearchAll(corp, jobId);
    log(`  팝빌 결과 ${list.length}건`);

    // 이미 있는 승인번호 — 새 건만 상세를 받는다
    const ntsList = list.map((a) => String(a.ntsconfirmNum ?? a.ntsConfirmNum ?? "").replace(/\D/g, "")).filter((n) => n.length === 24);
    const existing = new Set<string>();
    for (let i = 0; i < ntsList.length; i += 500) {
      const { data } = await sb.from("hometax_invoice").select("nts_confirm_num").in("nts_confirm_num", ntsList.slice(i, i + 500));
      for (const r of data ?? []) existing.add(String(r.nts_confirm_num));
    }

    const rows: HometaxInvoiceInsert[] = [];
    let skipped = 0;
    for (const abbr of list) {
      const nts = String(abbr.ntsconfirmNum ?? abbr.ntsConfirmNum ?? "").replace(/\D/g, "");
      let detail: Record<string, unknown> | null = null;
      if (input.fetchDetails !== false && nts.length === 24 && !existing.has(nts)) {
        try {
          detail = await htGetTaxinvoice(corp, nts);
        } catch (e) {
          log(`  상세 조회 실패 ${nts}: ${(e as Error).message}`); // 요약만으로 저장, 상세는 다음 수집 때
        }
      }
      const row = normalizeInvoice(input.book, input.direction, abbr, detail);
      if (!row) {
        skipped++;
        continue;
      }
      rows.push(row);
    }
    if (skipped) log(`  정규화 실패로 건너뜀 ${skipped}건`);

    // upsert: 수집 컬럼만. 이미 있는 행은 raw/금액이 갱신되지만 items·detail_fetched_at 은 비우지 않게 상세 없는 행에서 제외한다.
    let inserted = 0;
    let updated = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => {
        const isNew = !existing.has(r.nts_confirm_num);
        if (isNew) inserted++;
        else updated++;
        if (r.items === null) {
          // 상세를 못 받은(또는 기존 행) 건 — items·detail_fetched_at 을 덮어쓰지 않는다
          const { items: _i, detail_fetched_at: _d, ...rest } = r;
          void _i;
          void _d;
          return rest;
        }
        return r;
      });
      const { error } = await sb.from("hometax_invoice").upsert(chunk, { onConflict: "nts_confirm_num" });
      if (error) throw new Error(`저장 실패: ${error.message}`);
    }

    await sb
      .from("hometax_collection_job")
      .update({ state: "done", found: list.length, inserted, updated, finished_at: new Date().toISOString() })
      .eq("id", job.id);
    log(`  저장: 신규 ${inserted} · 갱신 ${updated}`);
    return { ok: true, jobId, found: list.length, inserted, updated };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** 한 책의 매출+매입을 차례로. 결과는 방향별. */
export async function collectBothDirections(sb: SupabaseClient, input: Omit<CollectInput, "direction">) {
  const out: Record<HometaxDirection, CollectResult> = {
    sell: await collectHometax(sb, { ...input, direction: "sell" }),
    buy: await collectHometax(sb, { ...input, direction: "buy" }),
  };
  return out;
}
