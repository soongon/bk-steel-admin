/**
 * 팝빌 사이트 엑셀(홈택스수집_세금계산서) → 수집본 적재 + 매출 대사 + 대조표 (기획 §11, 반자동 주간 사이클).
 *   npx tsx scripts/hometax-excel.ts <파일.xlsx> --book sl --dry-run        # 쓰기 없이 결정·대조표만
 *   npx tsx scripts/hometax-excel.ts <파일.xlsx> --book sl                  # 운영 반영(작업 1건 기록, 되돌리기 가능)
 *   npx tsx scripts/hometax-excel.ts --rollback <jobId>                     # 그 작업이 쓴 것 전부 되돌림
 *   npx tsx scripts/hometax-excel.ts --align <승인번호> --sale <매출번호> [--reason "..."]  # 금액 불일치: 매출을 계산서 금액으로(조정 라인+발행 기록+메모, 수금완료면 입금 기록도)
 *   npx tsx scripts/hometax-excel.ts --align-payment <매출번호>                            # 수금완료 매출의 입금 기록만 현재 합계에 맞춤(미수 0)
 *   npx tsx scripts/hometax-excel.ts --classify "<사업자번호|이름>=inventory|expense,..."    # 공급자 종류 지정(재고 매입처/비용 업체) — 그 뒤 엑셀을 다시 올리면 대기 건이 처리됨
 * 매입 파일도 같은 명령 — 방향(매출/매입)은 행마다 우리 사업자번호로 판정. 매입: 연결(P_link)·매입 생성(P_create)·비용 생성(R_create)·분류 대기(K_pending).
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
import { alignPaymentToTotal, alignSaleToInvoice, applyReconcile, planReconcile, rollbackActions, type Action, type ReconcileReport } from "../lib/hometax/reconcile";
import { applyBuy, classifyPartner, planBuy, type BuyReport } from "../lib/hometax/reconcile-buy";
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

async function writeReport(file: string, report: ReconcileReport, buy: BuyReport, meta: { book: Book; file: string; dryRun: boolean; jobId: string | null; range: string }) {
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
    ["N_missing", report.summary.N_missing ?? 0, "시스템에 매출 없음 → 거래처·매출 자동 생성(품목 미정) + 발행 기록 + 메모"],
    ["D_dup", report.summary.D_dup ?? 0, "같은 금액 매출이 이미 있음(재발행·이중 발급 의심) → 생성 안 함, 사장 확인"],
    ["D_modify", report.summary.D_modify ?? 0, "수정세금계산서 — 당초와 묶어 확인"],
    ["D_deleted", report.summary.D_deleted ?? 0, "지운 매출의 계산서 — 정리 끝났으면 무시, 아니면 수정세금계산서(−)·대체 매출 확인(자동 처리 안 함)"],
    ["S_skip", report.summary.S_skip ?? 0, "이미 처리된 건"],
    ["E_system_only", report.summary.E_system_only ?? 0, "시스템 자료 매출인데 홈택스에 없음 → 미발행?"],
    [],
    ["매입 케이스", "건수", "설명"],
    ["P_link", buy.summary.P_link ?? 0, "기존 매입과 금액 일치 → 승인번호 연결(자동)"],
    ["P_create", buy.summary.P_create ?? 0, "재고 매입처 → 매입 생성(품목 미정, 미지급 +30일)(자동)"],
    ["R_create", buy.summary.R_create ?? 0, "비용 업체 → 영수증·비용 생성(자동)"],
    ["K_pending", buy.summary.K_pending ?? 0, "분류 대기 — 거래처 종류 지정 필요(--classify 또는 화면 버튼)"],
    ["D_dup", buy.summary.D_dup ?? 0, "같은 금액 매입 있음 → 생성 안 함, 확인"],
    ["D_modify", buy.summary.D_modify ?? 0, "수정세금계산서 — 확인"],
    ["S_skip", buy.summary.S_skip ?? 0, "이미 처리된 건"],
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
  for (const d of report.decisions.filter((x) => ["X_amount", "D_modify", "D_dup", "D_deleted"].includes(x.case))) s1.addRow(toRow(d));
  const s2 = wb.addWorksheet("자동 처리");
  head(s2, cols);
  for (const d of report.decisions.filter((x) => ["B_popbill", "A_link", "N_missing", "S_skip"].includes(x.case))) s2.addRow(toRow(d));
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
  const s4 = wb.addWorksheet("매입");
  head(s4, [
    { header: "케이스", key: "case", width: 11 },
    { header: "작성일", key: "write_date", width: 12 },
    { header: "공급자", key: "supplierName", width: 22 },
    { header: "사업자번호", key: "supplierBiz", width: 14 },
    { header: "합계", key: "total", width: 14 },
    { header: "품목", key: "itemSummary", width: 30 },
    { header: "거래처 종류", key: "kind", width: 12 },
    { header: "제안", key: "suggestion", width: 10 },
    { header: "매입번호", key: "purchaseDocNo", width: 14 },
    { header: "설명", key: "note", width: 50 },
    { header: "승인번호", key: "nts", width: 26 },
    { header: "사장 분류(재고/비용)", key: "memo", width: 18 },
  ]);
  for (const d of buy.decisions)
    s4.addRow({
      case: d.case,
      write_date: d.write_date,
      supplierName: d.supplierName ?? "",
      supplierBiz: d.supplierBiz,
      total: d.total,
      itemSummary: d.itemSummary ?? "",
      kind: d.partner?.supply_kind ?? "",
      suggestion: d.suggestion ?? "",
      purchaseDocNo: d.purchaseDocNo ?? "",
      note: d.note,
      nts: d.nts,
      memo: "",
    });
  for (const col of s4.columns) if (col.key === "total") col.numFmt = "#,##0";
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

  if (has("classify")) {
    const spec = arg("classify") ?? "";
    const pairs = spec.split(",").map((x) => x.trim()).filter(Boolean);
    if (pairs.length === 0) throw new Error('--classify "<사업자번호|이름>=inventory|expense,..."');
    const actions: Action[] = [];
    for (const pr of pairs) {
      const [key, kind] = pr.split("=").map((x) => x.trim());
      if (kind !== "inventory" && kind !== "expense") throw new Error(`종류는 inventory 또는 expense: ${pr}`);
      actions.push(await classifyPartner(sb, key, kind, log));
    }
    const { data: job } = await sb
      .from("hometax_collection_job")
      .insert({ book: "sl", direction: "buy", date_type: "W", from_date: new Date().toISOString().slice(0, 10), to_date: new Date().toISOString().slice(0, 10), state: "done", source: "manual", file_name: `classify ${pairs.length}건`, found: pairs.length, updated: pairs.length, details: { actions }, finished_at: new Date().toISOString() })
      .select("id")
      .single();
    log(`완료 — 작업 ${job?.id}. 엑셀을 다시 올리면 대기 건이 처리됩니다.`);
    return;
  }

  if (has("align-payment")) {
    const docNo = arg("align-payment");
    if (!docNo) throw new Error("--align-payment <매출번호>");
    const { data: sale, error } = await sb.from("sale").select("id, book, doc_no, total_krw, settled_on").eq("doc_no", docNo).is("deleted_at", null).single();
    if (error || !sale) throw new Error(`매출을 찾을 수 없습니다: ${docNo}`);
    const { data: job } = await sb
      .from("hometax_collection_job")
      .insert({ book: sale.book, direction: "sell", date_type: "W", from_date: new Date().toISOString().slice(0, 10), to_date: new Date().toISOString().slice(0, 10), state: "running", source: "manual", file_name: `align-payment ${docNo}` })
      .select("id")
      .single();
    const pay = await alignPaymentToTotal(sb, String(sale.id), Number(sale.total_krw), log);
    const actions: Action[] = pay?.actions ?? [];
    if (pay?.skipped) {
      log("입금 기록이 여러 건이라 자동으로 맞추지 않음 — 확인 필요");
    } else if (pay && pay.diff !== 0) {
      const { data: memo } = await sb
        .from("sale_memo")
        .insert({ sale_id: sale.id, body: `[홈택스 대조] 입금 기록도 계산서 금액으로 맞춤: ${pay.prevReceived.toLocaleString("ko-KR")} → ${Number(sale.total_krw).toLocaleString("ko-KR")} (${pay.diff >= 0 ? "+" : ""}${pay.diff.toLocaleString("ko-KR")}원) — 미수 0, 통장 잔액 확인` })
        .select("id")
        .single();
      if (memo) actions.push({ type: "memo_created", memo_id: String(memo.id), sale_id: String(sale.id) });
    } else log(pay ? "입금 합이 이미 합계와 같음" : "연결된 입금 기록 없음(미수금 상태) — 할 일 없음");
    if (job) await sb.from("hometax_collection_job").update({ state: "done", found: 1, updated: actions.length ? 1 : 0, details: { actions }, finished_at: new Date().toISOString() }).eq("id", job.id);
    log(`완료 — 작업 ${job?.id} · 쓰기 ${actions.length}건`);
    return;
  }

  if (has("align")) {
    const nts = (arg("align") ?? "").replace(/[^0-9A-Za-z]/g, "").toLowerCase();
    const docNo = arg("sale");
    if (!nts || !docNo) throw new Error("--align <승인번호> --sale <매출번호>");
    const { data: sale, error } = await sb.from("sale").select("id, book, doc_no").eq("doc_no", docNo).is("deleted_at", null).single();
    if (error || !sale) throw new Error(`매출을 찾을 수 없습니다: ${docNo}`);
    const { data: job, error: jErr } = await sb
      .from("hometax_collection_job")
      .insert({ book: sale.book, direction: "sell", date_type: "W", from_date: new Date().toISOString().slice(0, 10), to_date: new Date().toISOString().slice(0, 10), state: "running", source: "manual", file_name: `align ${docNo} ← ${nts}` })
      .select("id")
      .single();
    if (jErr || !job) throw new Error(`작업 기록 실패: ${jErr?.message}`);
    try {
      const actions = await alignSaleToInvoice(sb, { saleId: String(sale.id), nts, reason: arg("reason") }, log);
      await sb.from("hometax_collection_job").update({ state: "done", found: 1, inserted: 0, updated: 1, details: { actions }, finished_at: new Date().toISOString() }).eq("id", job.id);
      log(`완료 — 작업 ${job.id} · 쓰기 ${actions.length}건. 되돌리기: npx tsx scripts/hometax-excel.ts --rollback ${job.id}`);
    } catch (e) {
      await sb.from("hometax_collection_job").update({ state: "failed", error: (e as Error).message, finished_at: new Date().toISOString() }).eq("id", job.id);
      throw e;
    }
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
  const buy = await planBuy(sb, book, parsed.rows, existingStatus);
  log(`대조(매출): ${JSON.stringify(report.summary)} · 대조(매입): ${JSON.stringify(buy.summary)}`);
  for (const d of buy.decisions) log(`  [매입] ${d.case.padEnd(10)} ${d.write_date} ${(d.supplierName ?? "").padEnd(14)} ${won(d.total).padStart(13)}  ${d.note}`);
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
      actions.push(...(await applyBuy(sb, book, parsed.rows, buy, log)));
      await sb
        .from("hometax_collection_job")
        .update({
          state: "done",
          inserted: actions.filter((a) => a.type === "invoice_insert").length,
          updated: parsed.rows.length - actions.filter((a) => a.type === "invoice_insert").length,
          details: { actions, summary: { ...report.summary, buy: buy.summary } },
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
  await writeReport(outFile, report, buy, { book, file: path.basename(file), dryRun, jobId, range: `${parsed.dateRange?.from} ~ ${parsed.dateRange?.to}` });
  log(`대조표: ${outFile}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
