import assert from "node:assert/strict";
import test from "node:test";
import { guessExpenseCategory, looksLikeInventory } from "../lib/hometax/reconcile-buy";

test("비용 분류 제안", () => {
  assert.equal(guessExpenseCategory("운송료"), "운송비");
  assert.equal(guessExpenseCategory("우리카드 렌트료 / 172호3255"), "차량");
  assert.equal(guessExpenseCategory("수리 및 출장비"), "수리비");
  assert.equal(guessExpenseCategory("장갑(참그린) 外"), "소모품");
  assert.equal(guessExpenseCategory("신세계 전기모타"), "설비·전기");
  assert.equal(guessExpenseCategory(null), "기타");
});

test("재고성 품목 판정(제안용)", () => {
  assert.equal(looksLikeInventory("철근 매각"), true);
  assert.equal(looksLikeInventory("'26.10월 철스크랩 매각(5차)_신라철강"), true);
  assert.equal(looksLikeInventory("고장력철근 SD400 H13 x 10,000 외2종"), true);
  assert.equal(looksLikeInventory("운송료"), false);
  assert.equal(looksLikeInventory("장갑(참그린) 外"), false);
  assert.equal(looksLikeInventory(null), false);
});
