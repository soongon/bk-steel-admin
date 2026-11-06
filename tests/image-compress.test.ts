import assert from "node:assert/strict";
import test from "node:test";
import { isHeicHeader } from "../lib/image-compress";
import { TRADE_DOC_IMAGE, TRADE_DOC_KIND_LABEL, type TradeDocKind } from "../lib/trade-doc";

/** ftyp 상자 — major, minor, compatible 순 */
function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const size = 16 + compatible.length * 4;
  const text = `ftyp${major}\0\0\0\0${compatible.join("")}`;
  return Uint8Array.from([0, 0, 0, size, ...Array.from(text, (c) => c.charCodeAt(0))]);
}

test("HEIC 판별 — 주 브랜드·호환 브랜드(mif1 시작 포함)", () => {
  assert.equal(isHeicHeader(ftyp("heic")), true);
  assert.equal(isHeicHeader(ftyp("heix")), true);
  assert.equal(isHeicHeader(ftyp("mif1", ["heic"])), true);
  assert.equal(isHeicHeader(ftyp("msf1", ["hevc"])), true);
});

test("HEIC 판별 — AVIF·MP4·JPEG·잘린 파일은 아님", () => {
  assert.equal(isHeicHeader(ftyp("avif", ["mif1"])), false);
  assert.equal(isHeicHeader(ftyp("mif1", ["avif"])), false);
  assert.equal(isHeicHeader(ftyp("isom", ["mp42"])), false);
  assert.equal(isHeicHeader(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])), false);
  assert.equal(isHeicHeader(new Uint8Array(0)), false);
  assert.equal(isHeicHeader(ftyp("heic").slice(0, 8)), false);
});

test("HEIC 판별 — 상자 크기 밖 바이트는 브랜드로 보지 않음", () => {
  const box = ftyp("isom");
  const withNext = new Uint8Array(box.length + 4);
  withNext.set(box);
  withNext.set(Array.from("heic", (c) => c.charCodeAt(0)), box.length);
  assert.equal(isHeicHeader(withNext), false);
});

test("사진 종류별 축소 기준 — 글자 문서는 2000, 현장·물건은 1600, 품질 0.8", () => {
  for (const kind of Object.keys(TRADE_DOC_KIND_LABEL) as TradeDocKind[]) assert.equal(TRADE_DOC_IMAGE[kind].quality, 0.8);
  for (const kind of ["weigh", "receipt", "material"] as const) assert.equal(TRADE_DOC_IMAGE[kind].maxEdge, 2000);
  for (const kind of ["site", "goods"] as const) assert.equal(TRADE_DOC_IMAGE[kind].maxEdge, 1600);
});
