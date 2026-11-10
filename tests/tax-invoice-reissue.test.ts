import assert from "node:assert/strict";
import test from "node:test";
import { MGT_KEY_MAX, mgtKeyCandidates, mgtKeyInUseFromError, popbillStateFlags, reissueHint } from "../lib/tax-invoice";

test("팝빌 상태: 전송중(3x3)·전송성공(3x4)만 발행취소 불가, 그 전·실패는 팝빌에 맡긴다", () => {
  for (const c of [300, 301, 302, 305, 310, 311, 312]) assert.equal(popbillStateFlags(c).ntsSent, false, String(c));
  for (const c of [303, 304, 313, 314]) assert.equal(popbillStateFlags(c).ntsSent, true, String(c));
  assert.equal(popbillStateFlags(304).transmitted, true);
  assert.equal(popbillStateFlags(303).transmitted, false);
  assert.equal(popbillStateFlags(600).cancelled, true);
  assert.equal(popbillStateFlags(610).cancelled, true);
  assert.deepEqual(popbillStateFlags(undefined), { ntsSent: false, transmitted: false, cancelled: false });
});

test("다시 발행 안내: 수금완료·홈택스·수기·팝빌별로 다르다", () => {
  assert.match(reissueHint("popbill", true), /수금완료/);
  assert.match(reissueHint("hometax", false), /홈택스/);
  assert.match(reissueHint("manual", false), /기록을 취소/);
  assert.match(reissueHint("popbill", false), /발행취소/);
});

test("문서관리번호 후보: 처음은 예전 번호, 다시 발행은 -2, -3 … 모두 24자 이내·서로 다름", () => {
  const c = mgtKeyCandidates("bk-20261107-001");
  assert.equal(c[0], "bk-20261107-001");
  assert.equal(c[1], "bk-20261107-001-2");
  assert.equal(c[2], "bk-20261107-001-3");
  const long = mgtKeyCandidates("manual-bk-20261107-001-extra");
  assert.ok(long.every((k) => k.length <= MGT_KEY_MAX));
  assert.equal(new Set(long).size, long.length);
});

test("문서번호 사용 여부: '문서 없음'(-11000005)만 안 쓰는 번호, 다른 오류는 모름(발행을 멈춘다)", () => {
  assert.equal(mgtKeyInUseFromError({ code: -11000005 }), false);
  assert.equal(mgtKeyInUseFromError({ code: "-11000005" }), false);
  assert.equal(mgtKeyInUseFromError({ code: -99999999 }), null); // 인증·연결 오류 등
  assert.equal(mgtKeyInUseFromError({}), null);
  assert.equal(mgtKeyInUseFromError(null), null);
});
