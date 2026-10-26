/**
 * 팝빌 사이트 "홈택스수집_세금계산서" 엑셀 → hometax_invoice 행 (기획 §11).
 * 형식 [확인 2026-10-26]: 시트 1개, 2줄 헤더(1행 그룹: 공급자/공급받는자/수탁자 · 2행 하위: 등록번호·종사업장·회사명·대표자명·이메일),
 * 열: 순번·작성일자·발행일자·전송일자·국세청승인번호·(공급자 5)·(공급받는자 5)·(수탁자 5)·합계금액·공급가액·세액·과세형태·문서형태(일반/수정)·
 *     비고·영수/청구/없음·품목(일자·명·규격·수량·단가·공급가액·세액·비고 — 첫 품목 1건만)·수집유형(팝빌/홈택스)·대사(O/X).
 * 헤더 이름으로 읽으므로 열 순서가 바뀌어도 된다. 방향(매출/매입)은 우리 사업자번호가 공급자인지 받는자인지로 정한다.
 */
import ExcelJS from "exceljs";
import type { Book } from "@/lib/book";
import { normalizeInvoice, normalizeNts } from "./normalize";
import type { HometaxDirection, HometaxInvoiceInsert } from "./types";

export type ExcelInvoiceRow = {
  rowNo: number;
  insert: HometaxInvoiceInsert;
  /** 팝빌 수집유형: '팝빌'(팝빌/우리 시스템에서 발행) · '홈택스'(직접 발행) */
  collectType: "팝빌" | "홈택스" | null;
  /** 팝빌 자체 대사 표시(O/X) */
  popbillMatched: boolean | null;
};

export type ExcelParseResult = {
  rows: ExcelInvoiceRow[];
  skipped: Array<{ rowNo: number; reason: string }>;
  headers: string[];
  dateRange: { from: string; to: string } | null;
};

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text ?? "");
    if ("result" in v) return v.result == null ? "" : String(v.result);
    return String(v);
  }
  return String(v).trim();
};
const cellDate = (v: ExcelJS.CellValue): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10); // exceljs 는 날짜 셀을 UTC 자정 Date 로 준다
  const s = cellText(v).replace(/\./g, "-");
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const cellNum = (v: ExcelJS.CellValue): string => {
  const s = cellText(v).replace(/,/g, "");
  return s === "" ? "" : s;
};

/** 1·2행을 합쳐 '공급자.등록번호' 식 헤더를 만든다. 그룹 헤더가 없는 열은 하위 이름 그대로. */
export function mergeHeaders(row1: string[], row2: string[]): string[] {
  const out: string[] = [];
  let group = "";
  const n = Math.max(row1.length, row2.length);
  for (let i = 0; i < n; i++) {
    const a = (row1[i] ?? "").trim();
    const b = (row2[i] ?? "").trim();
    if (a) group = a;
    out.push(b ? (group && group !== b ? `${group}.${b}` : b) : group);
  }
  return out;
}

export async function parsePopbillHometaxExcel(
  file: string | Buffer,
  opts: { book: Book; ourCorpNum: string; nowIso?: string },
): Promise<ExcelParseResult> {
  const wb = new ExcelJS.Workbook();
  if (typeof file === "string") await wb.xlsx.readFile(file);
  else await wb.xlsx.load(file as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("엑셀에 시트가 없습니다.");

  const rowVals = (r: number): string[] => {
    const row = ws.getRow(r);
    const out: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) out.push(cellText(row.getCell(c).value));
    return out;
  };
  const r1 = rowVals(1);
  const r2 = rowVals(2);
  // 2행이 하위 헤더(등록번호·회사명 …)면 2줄 헤더, 아니면 1줄 헤더
  const twoRow = r2.some((v) => /등록번호|회사명|대표자명/.test(v)) && !r2.some((v) => /^\d{4}-\d{2}-\d{2}/.test(v));
  const headers = twoRow ? mergeHeaders(r1, r2) : r1;
  const col = (name: string): number => headers.findIndex((h) => h === name);
  const need = ["국세청승인번호", "작성일자", "합계금액", "공급가액", "세액", "공급자.등록번호", "공급받는자.등록번호"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new Error(`팝빌 홈택스 엑셀 형식이 아닙니다 — 없는 열: ${missing.join(", ")}`);

  const our = normalizeNts(opts.ourCorpNum);
  const rows: ExcelInvoiceRow[] = [];
  const skipped: ExcelParseResult["skipped"] = [];
  const get = (row: ExcelJS.Row, name: string) => {
    const i = col(name);
    return i < 0 ? null : row.getCell(i + 1).value;
  };
  const dates: string[] = [];

  for (let r = twoRow ? 3 : 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nts = cellText(get(row, "국세청승인번호"));
    if (!nts) continue; // 빈 줄
    const supBiz = normalizeNts(cellText(get(row, "공급자.등록번호")));
    const invBiz = normalizeNts(cellText(get(row, "공급받는자.등록번호")));
    let direction: HometaxDirection | null = null;
    if (supBiz === our) direction = "sell";
    else if (invBiz === our) direction = "buy";
    if (!direction) {
      skipped.push({ rowNo: r, reason: `우리 사업자번호(${opts.ourCorpNum})가 공급자/받는자 어디에도 없음` });
      continue;
    }
    const docType = cellText(get(row, "문서형태")); // 일반 / 수정
    const itemName = cellText(get(row, "품목명"));
    const abbr: Record<string, unknown> = {
      ntsconfirmNum: nts,
      writeDate: cellDate(get(row, "작성일자")),
      issueDate: cellDate(get(row, "발행일자")),
      sendDate: cellDate(get(row, "전송일자")),
      taxType: cellText(get(row, "과세형태")) || null,
      purposeType: cellText(get(row, "영수/청구/없음")) || null,
      modifyYN: docType === "수정" ? "Y" : "N",
      remark1: cellText(get(row, "비고")) || null,
      supplyCostTotal: cellNum(get(row, "공급가액")),
      taxTotal: cellNum(get(row, "세액")),
      totalAmount: cellNum(get(row, "합계금액")),
      itemName: itemName || null,
      invoicerCorpNum: cellText(get(row, "공급자.등록번호")),
      invoicerTaxRegID: cellText(get(row, "공급자.종사업장")) || null,
      invoicerCorpName: cellText(get(row, "공급자.회사명")) || null,
      invoicerCEOName: cellText(get(row, "공급자.대표자명")) || null,
      invoicerEmail: cellText(get(row, "공급자.이메일")) || null,
      invoiceeCorpNum: cellText(get(row, "공급받는자.등록번호")),
      invoiceeTaxRegID: cellText(get(row, "공급받는자.종사업장")) || null,
      invoiceeCorpName: cellText(get(row, "공급받는자.회사명")) || null,
      invoiceeCEOName: cellText(get(row, "공급받는자.대표자명")) || null,
      invoiceeEmail1: cellText(get(row, "공급받는자.이메일")) || null,
      trusteeCorpNum: cellText(get(row, "수탁자.등록번호")) || null,
      trusteeCorpName: cellText(get(row, "수탁자.회사명")) || null,
      trusteeCEOName: cellText(get(row, "수탁자.대표자명")) || null,
      trusteeEmail: cellText(get(row, "수탁자.이메일")) || null,
      // 팝빌 사이트 전용 열 — raw 에 그대로
      popbillCollectType: cellText(get(row, "수집유형")) || null,
      popbillMatched: cellText(get(row, "대사")) || null,
      docType: docType || null,
    };
    // 첫 품목 1건(팝빌 엑셀 한계). 품목공급가액 ≠ 공급가액이면 다품목 — 상세 라인 불완전.
    const detail: Record<string, unknown> | null = itemName
      ? {
          detailList: [
            {
              serialNum: 1,
              purchaseDT: cellDate(get(row, "품목일자"))?.replace(/-/g, "") ?? null,
              itemName,
              spec: cellText(get(row, "품목규격")) || null,
              qty: cellNum(get(row, "품목수량")) || null,
              unitCost: cellNum(get(row, "품목단가")) || null,
              supplyCost: cellNum(get(row, "품목공급가액")) || null,
              tax: cellNum(get(row, "품목세액")) || null,
              remark: cellText(get(row, "품목비고")) || null,
            },
          ],
          itemsPartial: Number(cellNum(get(row, "품목공급가액")) || 0) !== Number(cellNum(get(row, "공급가액")) || 0),
        }
      : null;
    const insert = normalizeInvoice(opts.book, direction, abbr, detail, opts.nowIso);
    if (!insert) {
      skipped.push({ rowNo: r, reason: `승인번호(${nts}) 또는 작성일자를 읽지 못함` });
      continue;
    }
    insert.source = "excel";
    rows.push({
      rowNo: r,
      insert,
      collectType: abbr.popbillCollectType === "팝빌" ? "팝빌" : abbr.popbillCollectType === "홈택스" ? "홈택스" : null,
      popbillMatched: abbr.popbillMatched === "O" ? true : abbr.popbillMatched === "X" ? false : null,
    });
    dates.push(insert.write_date);
  }
  dates.sort();
  return { rows, skipped, headers, dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null };
}
