import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { mergeHeaders, parsePopbillHometaxExcel } from "../lib/hometax/excel";

test("2줄 헤더 합치기 — 그룹명.하위명, 그룹 없는 열은 그대로", () => {
  const h = mergeHeaders(["순번", "작성일자", "공급자", "", "", "합계금액"], ["", "", "등록번호", "회사명", "대표자명", ""]);
  assert.deepEqual(h, ["순번", "작성일자", "공급자.등록번호", "공급자.회사명", "공급자.대표자명", "합계금액"]);
});

async function fixture(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("홈택스수집_세금계산서");
  ws.addRow(["순번", "작성일자", "발행일자", "전송일자", "국세청승인번호", "공급자", "", "", "", "", "공급받는자", "", "", "", "", "합계금액", "공급가액", "세액", "과세형태", "문서형태", "비고", "영수/청구/없음", "품목일자", "품목명", "품목규격", "품목수량", "품목단가", "품목공급가액", "품목세액", "품목비고", "수집유형", "대사"]);
  ws.addRow(["", "", "", "", "", "등록번호", "종사업장", "회사명", "대표자명", "이메일", "등록번호", "종사업장", "회사명", "대표자명", "이메일", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  // 매출(공급자=우리) · 날짜 셀은 Date
  ws.addRow([1, new Date(Date.UTC(2026, 9, 23)), new Date(Date.UTC(2026, 9, 24)), new Date(Date.UTC(2026, 9, 24)), "20261023-41000203-000048fb", "514-21-54714", "", "신라철강", "최원식", "", "280-21-02462", "", "현명테크", "이현수", "", 4978710, 4526100, 452610, "과세", "일반", "", "청구", new Date(Date.UTC(2026, 9, 23)), "철근", "D10 SD400 8M", 660, 900, 2661300, 266130, "", "팝빌", "O"]);
  // 매입(받는자=우리) · 수정분 · 문자열 날짜
  ws.addRow([2, "2026-10-07", "2026-10-07", "2026-10-08", "20261007-11111111-0000AB12", "123-45-67890", "", "○○철거", "김소장", "", "514-21-54714", "", "신라철강", "최원식", "", -1527339, -1388490, -138849, "과세", "수정", "", "청구", "", "고철", "", "", "", -1388490, -138849, "", "홈택스", "X"]);
  // 남의 계산서(우리 번호 없음) → 건너뜀
  ws.addRow([3, "2026-10-07", "", "", "20261007-22222222-00000001", "111-11-11111", "", "A", "", "", "222-22-22222", "", "B", "", "", 100, 100, 0, "과세", "일반", "", "청구", "", "", "", "", "", "", "", "", "홈택스", "X"]);
  const file = path.join(os.tmpdir(), `popbill-fixture-${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(file);
  return file;
}

test("팝빌 엑셀 파싱 — 방향·날짜·승인번호·품목·수집유형", async () => {
  const file = await fixture();
  const r = await parsePopbillHometaxExcel(file, { book: "sl", ourCorpNum: "5142154714", nowIso: "2026-10-26T00:00:00Z" });
  assert.equal(r.rows.length, 2);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /우리 사업자번호/);
  assert.deepEqual(r.dateRange, { from: "2026-10-07", to: "2026-10-23" });
  const sell = r.rows.find((x) => x.insert.direction === "sell")!;
  assert.equal(sell.insert.nts_confirm_num, "2026102341000203000048fb");
  assert.equal(sell.insert.write_date, "2026-10-23");
  assert.equal(sell.insert.issue_date, "2026-10-24");
  assert.equal(sell.insert.invoicee.biz_no, "2802102462");
  assert.equal(sell.insert.invoicee.name, "현명테크");
  assert.equal(sell.insert.total_amount, 4978710);
  assert.equal(sell.insert.items?.length, 1);
  assert.equal(sell.insert.items?.[0].qty, 660);
  assert.equal(sell.insert.source, "excel");
  assert.equal(sell.collectType, "팝빌");
  assert.equal(sell.popbillMatched, true);
  assert.equal((sell.insert.raw as { detail?: { itemsPartial?: boolean } }).detail?.itemsPartial, true); // 품목1 ≠ 전체 → 다품목
  const buy = r.rows.find((x) => x.insert.direction === "buy")!;
  assert.equal(buy.insert.modify_code, -1); // 문서형태 '수정'
  assert.equal(buy.insert.supplier.biz_no, "1234567890");
  assert.equal(buy.insert.nts_confirm_num, "20261007111111110000ab12");
  assert.equal(buy.collectType, "홈택스");
});

test("형식이 다른 엑셀은 명확한 오류", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("x").addRow(["a", "b"]);
  const file = path.join(os.tmpdir(), `bad-${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(file);
  await assert.rejects(() => parsePopbillHometaxExcel(file, { book: "sl", ourCorpNum: "5142154714" }), /형식이 아닙니다/);
});
