/**
 * 팝빌 사이트 엑셀(홈택스수집_세금계산서) → 수집본 적재 + 매출 대사 + 대조표 (기획 §11, 반자동 주간 사이클).
 *   npx tsx scripts/hometax-excel.ts <파일.xlsx> --book sl --dry-run        # 쓰기 없이 결정·대조표만
 *   npx tsx scripts/hometax-excel.ts <파일.xlsx> --book sl                  # 운영 반영(작업 1건 기록, 되돌리기 가능)
 *   npx tsx scripts/hometax-excel.ts --rollback <jobId>                     # 그 작업이 쓴 것 전부 되돌림
 *   옵션: --out <폴더>(대조표 저장 위치, 기본 ~/Downloads)
 * 자동: B 팝빌 발행분 일치 · A 매출 일치→발행 기록 생성+메모 · C 거래처 사업자번호 채움.
 * 사람: 금액 불일치 · 누락 · 수정분 · 시스템에만 있는 자료 매출(E) — 대조표 '판단 필요' 시트.
 * env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isValidBook, type Book } from "../lib/book";
import { parsePopbillHometaxExcel } from "../lib/hometax/excel";
import { applyReconcile, planReconcile, rollbackActions, type Action, type ReconcileReport } from "../lib/hometax/reconcile";
import { corpNumForBook } from "../lib/hometax/collect";
import type { HometaxMatchStatus } from "../lib/hometax/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function writeReport(file: string, report: ReconcileReport, meta: { book: Book; file: string; dryRun: boolean; jobId: string | null; range: string }) {
  const wb = new ExcelJS.Workbook();
  const head = (ws: ExcelJS.Worksheet, cols: Array<{ header: string; key: string; width?: number }>) => {
    ws.columns = cols.map((c) => ({ ...c, width: c.width ?? Math.max(10, c.header.length * 2.2) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const s0 = wb.addWorksheet("요약");
  s0.addRows([
    ["파일", meta.file],
    ["책", meta.book],
    ["기간(작성일)", meta.range],
    ["모드", meta.dryRun ? "dry-run(쓰기 없음)" : `반영 완료 — 작업 ${meta.jobId}`],
    [],
    ["케이스", "건수", "설명"],
    ["B_popbill", report.summary.B_popbill ?? 0, "팝빌 발행분 — 승인번호로 발행 기록과 일치(자동)"],
    ["A_link", report.summary.A_link ?? 0, "매출 일치·발행 기록 없음 → 발행 기록 생성 + 메모(자동)"],
    ["X_amount", report.summary.X_amount ?? 0, "거래처 있음·금액 불일치 → 사장 판단(계산서 금액으로 맞춤 + 메모)"],
    ["N_missing", report.summary.N_missing ?? 0, "시스템에 매출 없음 → 사장 직접 입력 + 메모"],
    ["D_modify", report.summary.D_modify ?? 0, "수정세금계산서 — 당초와 묶어 확인"],
    ["S_skip", report.summary.S_skip ?? 0, "이미 처리된 건"],
    ["E_system_only", report.summary.E_system_only ?? 0, "시스템 자료 매출인데 홈택스에 없음 → 미발행?"],
  ]);
  s0.getColumn(1).width = 16;
  s0.getColumn(3).width = 70;

  const cols = [
    { header: "케이스", key: "case", width: 12 },
    { header: "작성일", key: "write_date", width: 12 },
    { header: "수집유형", key: "collectType", width: 9 },
    { header: "공급받는자", key: "partyName", width: 22 },
    { header: "사업자번호", key: "partyBiz", width: 14 },
    { header: "합계", key: "total", width: 14 },
    { header: "수정", key: "isModify", width: 6 },
    { header: "매출번호", key: "saleDocNo", width: 14 },
    { header: "수금완료", key: "settled", width: 8 },
    { header: "후보", key: "cands", width: 50 },
    { header: "거래처 번호 채움", key: "fix", width: 24 },
    { header: "설명", key: "note", width: 50 },
    { header: "승인번호", key: "nts", width: 26 },
    { header: "사장 메모", key: "memo", width: 30 },
  ];
  const toRow = (d: ReconcileReport["decisions"][number]) => ({
    case: d.case,
    write_date: d.write_date,
    collectType: d.collectType ?? "",
    partyName: d.partyName ?? "",
    partyBiz: d.partyBiz,
    total: d.total,
    isModify: d.isModify ? "수정" : "",
    saleDocNo: d.saleDocNo ?? "",
    settled: d.settled === undefined ? "" : d.settled ? "O" : "",
    cands: d.candidates?.map((c) => `${c.doc_no} ${won(c.total)} (${c.ordered_on}${c.settled ? ", 수금완료" : ""}${c.has_invoice ? ", 발행됨" : ""})`).join("\n") ?? "",
    fix: d.partnerFix ? `${d.partnerFix.name} ← ${d.partnerFix.new_biz}` : "",
    note: d.note,
    nts: d.nts,
    memo: "",
  });
  const s1 = wb.addWorksheet("판단 필요");
  head(s1, cols);
  for (const d of report.decisions.filter((x) => ["X_amount", "N_missing", "D_modify"].includes(x.case))) s1.addRow(toRow(d));
  const s2 = wb.addWorksheet("자동 처리");
  head(s2, cols);
  for (const d of report.decisions.filter((x) => ["B_popbill", "A_link", "S_skip"].includes(x.case))) s2.addRow(toRow(d));
  const s3 = wb.addWorksheet("시스템에만 있음(E)");
  head(s3, [
    { header: "매출번호", key: "doc_no", width: 14 },
    { header: "주문일", key: "ordered_on", width: 12 },
    { header: "거래처", key: "partner_name", width: 22 },
    { header: "사업자번호", key: "partner_biz", width: 14 },
    { header: "합계", key: "total_krw", width: 14 },
    { header: "상태", key: "status", width: 12 },
    { header: "수금완료", key: "settled", width: 8 },
    { header: "설명", key: "note", width: 50 },
    { header: "사장 메모", key: "memo", width: 30 },
  ]);
  for (const s of report.systemOnly) s3.addRow({ ...s, settled: s.settled_on ? "O" : "", memo: "" });
  for (const ws of [s1, s2, s3]) {
    for (const col of ws.columns) {
      if (col.key === "total" || col.key === "total_krw") col.numFmt = "#,##0";
    }
    ws.eachRow((row, i) => {
      if (i > 1) row.alignment = { vertical: "top", wrapText: true };
    });
  }
  await wb.xlsx.writeFile(file);
}

async function main() {
  const sb = client();
  const log = (m: string) => console.log(m);

  if (has("rollback")) {
    const jobId = arg("rollback");
    if (!jobId) throw new Error("--rollback <jobId>");
    const { data: job, error } = await sb.from("hometax_collection_job").select("id, state, details, file_name").eq("id", jobId).single();
    if (error || !job) throw new Error(`작업을 찾을 수 없습니다: ${error?.message ?? jobId}`);
    if (job.state === "rolled_back") throw new Error("이미 되돌린 작업입니다.");
    const actions = ((job.details as { actions?: Action[] } | null)?.actions ?? []) as Action[];
    log(`되돌리기: ${jobId} (${job.file_name ?? "-"}) · 쓰기 ${actions.length}건`);
    await rollbackActions(sb, actions, log);
    await sb.from("hometax_collection_job").update({ state: "rolled_back", rolled_back_at: new Date().toISOString() }).eq("id", jobId);
    log("완료.");
    return;
  }

  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("사용법: npx tsx scripts/hometax-excel.ts <파일.xlsx> --book sl [--dry-run]");
  const book = arg("book") ?? "sl";
  if (!isValidBook(book) || book === "b") throw new Error("--book 은 sl 또는 bk");
  const dryRun = has("dry-run");
  const outDir = arg("out") ?? path.join(os.homedir(), "Downloads");

  const corp = await corpNumForBook(sb, book);
  const parsed = await parsePopbillHometaxExcel(file, { book, ourCorpNum: corp });
  log(`엑셀: ${parsed.rows.length}행 읽음 (매출 ${parsed.rows.filter((r) => r.insert.direction === "sell").length} · 매입 ${parsed.rows.filter((r) => r.insert.direction === "buy").length}) · 건너뜀 ${parsed.skipped.length} · 작성일 ${parsed.dateRange?.from}~${parsed.dateRange?.to}`);
  for (const s of parsed.skipped) log(`  건너뜀 ${s.rowNo}행: ${s.reason}`);

  const { data: existing } = await sb.from("hometax_invoice").select("nts_confirm_num, match_status").in("nts_confirm_num", parsed.rows.map((r) => r.insert.nts_confirm_num));
  const existingStatus = new Map<string, HometaxMatchStatus>((existing ?? []).map((e) => [String(e.nts_confirm_num), e.match_status as HometaxMatchStatus]));

  const report = await planReconcile(sb, book, parsed.rows, existingStatus);
  log(`대조: ${JSON.stringify(report.summary)}`);
  for (const d of report.decisions) log(`  ${d.case.padEnd(10)} ${d.write_date} ${(d.partyName ?? "").padEnd(14)} ${won(d.total).padStart(13)}  ${d.note}`);
  if (report.systemOnly.length) {
    log(`시스템에만 있음(E) ${report.systemOnly.length}건:`);
    for (const s of report.systemOnly) log(`  ${s.doc_no} ${s.ordered_on} ${s.partner_name ?? ""} ${won(s.total_krw)}`);
  }

  let jobId: string | null = null;
  if (!dryRun) {
    const { data: job, error } = await sb
      .from("hometax_collection_job")
      .insert({
        book,
        direction: "sell",
        date_type: "W",
        from_date: parsed.dateRange?.from ?? new Date().toISOString().slice(0, 10),
        to_date: parsed.dateRange?.to ?? new Date().toISOString().slice(0, 10),
        state: "running",
        source: "excel",
        file_name: path.basename(file),
        found: parsed.rows.length,
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(`작업 기록 실패: ${error?.message}`);
    jobId = String(job.id);
    try {
      const actions = await applyReconcile(sb, book, parsed.rows, report, jobId, log);
      await sb
        .from("hometax_collection_job")
        .update({
          state: "done",
          inserted: actions.filter((a) => a.type === "invoice_insert").length,
          updated: parsed.rows.length - actions.filter((a) => a.type === "invoice_insert").length,
          details: { actions, summary: report.summary },
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      log(`반영 완료 — 작업 ${jobId} · 쓰기 ${actions.length}건. 되돌리기: npx tsx scripts/hometax-excel.ts --rollback ${jobId}`);
    } catch (e) {
      await sb.from("hometax_collection_job").update({ state: "failed", error: (e as Error).message, finished_at: new Date().toISOString() }).eq("id", jobId);
      throw e;
    }
  }

  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(/[: ]/g, "-").slice(0, 16);
  const outFile = path.join(outDir, `홈택스_대조표_${book}_${parsed.dateRange?.from ?? ""}_${parsed.dateRange?.to ?? ""}${dryRun ? "_dryrun" : ""}_${stamp}.xlsx`);
  await writeReport(outFile, report, { book, file: path.basename(file), dryRun, jobId, range: `${parsed.dateRange?.from} ~ ${parsed.dateRange?.to}` });
  log(`대조표: ${outFile}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
