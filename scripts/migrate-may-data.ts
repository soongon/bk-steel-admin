#!/usr/bin/env tsx
/**
 * 5월 워크북 CSV → Supabase v1 스키마 마이그레이션
 *
 * 사용법:
 *   npm run migrate:may-data            # 실제 실행
 *   npm run migrate:may-data:dry        # dry-run (DB 변경 없음, 변환 결과만 출력)
 *
 * 환경 변수 (.env):
 *   SUPABASE_URL                  Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_ROLE_KEY     service role key (RLS 우회용)
 *   CSV_DIR                       (선택) CSV 위치. 기본: docs/reference-data
 *
 * 참조 문서:
 *   docs/시스템_도메인_룰_v1.md
 *   docs/시스템_DB_스키마_v1.md
 *   docs/철근_제품마스터.md
 */

// .env.local (gitignored, 비밀 보관용) → .env.development (커밋, 공개) 순으로 로드
// Next.js 앱은 자동이지만, standalone TS 스크립트는 명시 필요
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.development" });

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================
// 환경 설정
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CSV_DIR = process.env.CSV_DIR ?? "docs/reference-data";
const DRY_RUN = process.argv.includes("--dry-run");
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const ACTOR_LABEL = `seed_${TODAY}`;

if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error(
    "✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다. " +
      ".env 파일을 확인하세요. (또는 --dry-run 사용)",
  );
  process.exit(1);
}

const supabase: SupabaseClient = DRY_RUN
  ? (null as unknown as SupabaseClient)
  : createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

// ============================================================
// 도메인 상수
// ============================================================
type Book = "bk" | "sl" | "b";

const BOOK_BY_BANK_CODE: Record<string, Book> = {
  "법인A": "bk",
  "사업자A": "sl",
  "B계좌": "b",
};

const BOOK_LABEL: Record<Book, string> = {
  bk: "법인",
  sl: "사업자",
  b: "B계좌",
};

type AcquiredUnit = "ton" | "kg" | "ea" | "piece" | "bundle" | "set";

const UNIT_MAP: Record<string, AcquiredUnit> = {
  EA: "ea",
  ea: "ea",
  "개": "ea",
  "톤": "ton",
  ton: "ton",
  kg: "kg",
  Kg: "kg",
  KG: "kg",
  "번들": "bundle",
  "세트": "set",
};

// 기본 창고 (시드 단계에서 1개 생성. 사용자가 운영 시 zone 추가/조정)
const DEFAULT_WAREHOUSE_CODE = "WH-MAIN";
const DEFAULT_WAREHOUSE_NAME = "본 야적장";
const DEFAULT_ZONE_CODES: Record<Book, string> = {
  bk: "Zone-BK",
  sl: "Zone-SL",
  b: "Zone-B",
};

// ============================================================
// 헬퍼
// ============================================================
function loadCsv(filename: string): Record<string, string>[] {
  const path = join(CSV_DIR, filename);
  const content = readFileSync(path, "utf8").replace(/^﻿/, ""); // BOM 제거
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function normalizeName(s: string | undefined | null): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

function parseKrw(s: string | undefined | null): number {
  if (!s) return 0;
  const cleaned = s.toString().replace(/[, ]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseInt0(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = Number(s.toString().replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isDocumentedFromColumn(value: string | undefined): boolean {
  return normalizeName(value) === "O";
}

/**
 * CSV의 '결제완료'/'수금완료' 같은 "O" 마커를 실제 날짜로 변환.
 * 마커가 'O'면 fallbackDate를 반환, 아니면 null.
 */
function dateIfMarked(
  marker: string | undefined,
  ...fallbackDates: (string | undefined)[]
): string | null {
  if (normalizeName(marker) !== "O") return null;
  for (const d of fallbackDates) {
    const trimmed = d?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

function log(msg: string) {
  console.log(msg);
}

function warn(msg: string) {
  console.warn(`  ⚠ ${msg}`);
}

async function run<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  if (DRY_RUN) {
    log(`  [dry-run] ${label} skipped`);
    return undefined;
  }
  try {
    const result = await fn();
    log(`  ✓ ${label}`);
    return result;
  } catch (e: any) {
    console.error(`  ✗ ${label}: ${e?.message ?? e}`);
    throw e;
  }
}

// ============================================================
// 1. 거래처 (partner) + 별칭 (partner_alias)
// ============================================================
async function importPartners() {
  logSection("[1/9] 거래처 (partner + partner_alias)");

  const rows = loadCsv("5.거래처.csv");
  // 5.거래처에 같은 거래처가 매출/매입 구분으로 중복 등장할 수 있음 — name으로 dedup
  const byName = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const name = normalizeName(r["거래처명"]);
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, r);
  }

  let idx = 0;
  const partners = Array.from(byName.values()).map((r) => {
    idx++;
    const name = normalizeName(r["거래처명"]);
    return {
      code: `P-${String(idx).padStart(3, "0")}`,
      name,
      business_no: normalizeName(r["사업자번호"]) || null,
      representative: normalizeName(r["대표자"]) || null,
      phone: normalizeName(r["연락처"]) || null,
      address: normalizeName(r["주소/현장"]) || null,
      notes: normalizeName(r["메모"]) || null,
    };
  });

  log(`  • 거래처 ${partners.length}건 upsert 예정`);
  if (DRY_RUN) {
    partners.slice(0, 3).forEach((p) => log(`    - ${p.code} ${p.name}`));
    if (partners.length > 3) log(`    ... +${partners.length - 3}건`);
    return new Map<string, string>();
  }

  await run("partner upsert", async () => {
    const { error } = await supabase
      .from("partner")
      .upsert(partners, { onConflict: "code" });
    if (error) throw error;
  });

  // ID lookup 맵 (name → id) — alias도 함께 로드
  const { data: inserted } = await supabase
    .from("partner")
    .select("id, name, partner_alias(alias)");
  const idByName = new Map<string, string>();
  for (const p of inserted ?? []) {
    idByName.set(p.name, p.id);
    for (const a of (p.partner_alias ?? []) as { alias: string }[]) {
      idByName.set(a.alias, p.id);
    }
  }

  log(`  • partner 조회: ${idByName.size}건 (별칭 포함)`);
  return idByName;
}

// ============================================================
// getOrCreatePartner — sale/purchase CSV의 거래처가 master에 없으면
// 1) substring(prefix/suffix) 매칭으로 alias 자동 생성, 또는
// 2) 신규 partner 자동 생성 (메모 표기: 'CSV 마이그레이션 자동 생성')
// ============================================================
async function getOrCreatePartner(
  rawName: string,
  partnerIdByName: Map<string, string>,
): Promise<string | null> {
  const name = normalizeName(rawName);
  if (!name) return null;

  // 1. 이미 알려진 이름 (master 또는 이전에 추가된 alias/auto)
  if (partnerIdByName.has(name)) return partnerIdByName.get(name)!;

  // 2. substring 매칭 (5자 이상에서만 — '안강' 같은 짧은 단어 오매칭 방지)
  if (name.length >= 5) {
    for (const [existing, id] of partnerIdByName) {
      if (existing.length < 5 || existing === name) continue;
      if (existing.startsWith(name) || name.startsWith(existing)) {
        log(`    + alias 자동: '${name}' → '${existing}'`);
        partnerIdByName.set(name, id);
        if (!DRY_RUN) {
          await supabase
            .from("partner_alias")
            .upsert({ partner_id: id, alias: name }, { onConflict: "alias" });
        }
        return id;
      }
    }
  }

  // 3. 신규 partner 자동 생성
  log(`    + partner 자동 생성: '${name}'`);
  if (DRY_RUN) {
    const fakeId = `dry-new-${name}`;
    partnerIdByName.set(name, fakeId);
    return fakeId;
  }
  const { data, error } = await supabase
    .from("partner")
    .insert({
      name,
      notes: `CSV 마이그레이션 자동 생성 (${ACTOR_LABEL}) — 정보 보강 필요`,
    })
    .select("id")
    .single();
  if (error) {
    warn(`partner 자동 생성 실패: '${name}' — ${error.message}`);
    return null;
  }
  partnerIdByName.set(name, data.id);
  return data.id;
}

// ============================================================
// 2. 창고 + 책별 zone
// ============================================================
async function importWarehouse(): Promise<{
  warehouseId: string;
  zoneIdByBook: Record<Book, string>;
}> {
  logSection("[2/9] 창고 + zone");

  if (DRY_RUN) {
    log(`  • ${DEFAULT_WAREHOUSE_NAME} + zone 3개 (Zone-BK / Zone-SL / Zone-B)`);
    return {
      warehouseId: "dry-run",
      zoneIdByBook: { bk: "dry", sl: "dry", b: "dry" },
    };
  }

  // 창고
  const { data: existing } = await supabase
    .from("warehouse")
    .select("id")
    .eq("code", DEFAULT_WAREHOUSE_CODE)
    .maybeSingle();

  let warehouseId: string;
  if (existing) {
    warehouseId = existing.id;
    log(`  • 기존 창고 사용: ${DEFAULT_WAREHOUSE_CODE} (${warehouseId})`);
  } else {
    const { data, error } = await supabase
      .from("warehouse")
      .insert({
        code: DEFAULT_WAREHOUSE_CODE,
        name: DEFAULT_WAREHOUSE_NAME,
        kind: "owned",
      })
      .select("id")
      .single();
    if (error) throw error;
    warehouseId = data!.id;
    log(`  ✓ 창고 생성: ${DEFAULT_WAREHOUSE_CODE} (${warehouseId})`);
  }

  // Zone (책별)
  const zoneIdByBook: Record<Book, string> = { bk: "", sl: "", b: "" };
  for (const book of ["bk", "sl", "b"] as Book[]) {
    const zoneCode = DEFAULT_ZONE_CODES[book];
    const { data: z } = await supabase
      .from("warehouse_zone")
      .select("id")
      .eq("warehouse_id", warehouseId)
      .eq("zone_code", zoneCode)
      .maybeSingle();
    if (z) {
      zoneIdByBook[book] = z.id;
    } else {
      const { data, error } = await supabase
        .from("warehouse_zone")
        .insert({
          warehouse_id: warehouseId,
          zone_code: zoneCode,
          preferred_book: book,
        })
        .select("id")
        .single();
      if (error) throw error;
      zoneIdByBook[book] = data!.id;
      log(`  ✓ zone 생성: ${zoneCode} → ${BOOK_LABEL[book]}`);
    }
  }

  return { warehouseId, zoneIdByBook };
}

// ============================================================
// 3. 통장 (bank_account)
// ============================================================
async function importBankAccounts() {
  logSection("[3/9] 통장 (bank_account)");

  const rows = loadCsv("6.통장.csv");
  const seen = new Set<string>();
  const accounts: any[] = [];
  for (const r of rows) {
    const code = normalizeName(r["통장"]);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const book = BOOK_BY_BANK_CODE[code];
    if (!book) {
      warn(`unknown 통장 코드: ${code}`);
      continue;
    }
    accounts.push({
      book,
      code,
      bank_name: code, // 5월 데이터에는 은행명 컬럼 없음 → 동일하게
      kind: book === "bk" ? "corporate" : book === "sl" ? "personal" : "b_hidden",
    });
  }

  log(`  • 통장 ${accounts.length}건 upsert 예정`);
  if (DRY_RUN) {
    accounts.forEach((a) =>
      log(`    - ${a.code} (${BOOK_LABEL[a.book as Book]} / ${a.kind})`),
    );
    const fake = new Map<string, string>();
    accounts.forEach((a) => fake.set(a.code, `dry-bank-${a.code}`));
    return fake;
  }

  await run("bank_account upsert", async () => {
    const { error } = await supabase
      .from("bank_account")
      .upsert(accounts, { onConflict: "book,code" });
    if (error) throw error;
  });

  const { data } = await supabase.from("bank_account").select("id, code, book");
  const idByCode = new Map<string, string>();
  for (const a of data ?? []) idByCode.set(a.code, a.id);
  return idByCode;
}

// ============================================================
// 4. 통장 거래 (bank_transaction)
// ============================================================
async function importBankTransactions(
  bankIdByCode: Map<string, string>,
  saleIdByDocNo: Map<string, string>,
  purchaseIdByDocNo: Map<string, string>,
) {
  logSection("[4/9] 통장 거래 (bank_transaction)");

  const rows = loadCsv("6.통장.csv");
  // "시작 잔고" 행은 skip (운영 거래 아님 — 초기화는 별도 처리 권장)
  const txns: any[] = [];
  for (const r of rows) {
    const category = normalizeName(r["분류"]);
    if (category === "시작") continue;

    const code = normalizeName(r["통장"]);
    const bankId = bankIdByCode.get(code);
    if (!bankId) {
      warn(`통장 코드 매핑 실패: ${code} (적요: ${r["적요"]})`);
      continue;
    }
    const book = BOOK_BY_BANK_CODE[code];
    const matchId = normalizeName(r["매칭ID"]);
    const inAmt = parseKrw(r["입금(원)"]);
    const outAmt = parseKrw(r["출금(원)"]);
    const amount = inAmt - outAmt; // 양수: 입금, 음수: 출금

    txns.push({
      bank_account_id: bankId,
      book,
      txn_on: r["일자"],
      amount_krw: amount,
      balance_after_krw: parseKrw(r["누적잔고(원)"]) || null,
      counterparty: null,
      sale_id: matchId && saleIdByDocNo.get(matchId) ? saleIdByDocNo.get(matchId) : null,
      purchase_id:
        matchId && purchaseIdByDocNo.get(matchId)
          ? purchaseIdByDocNo.get(matchId)
          : null,
      category,
      notes: normalizeName(r["적요"]) + (r["메모"] ? ` | ${r["메모"]}` : ""),
    });
  }

  log(`  • bank_transaction ${txns.length}건 insert 예정`);
  if (DRY_RUN) {
    txns.slice(0, 3).forEach((t) =>
      log(
        `    - ${t.txn_on} ${t.amount_krw > 0 ? "+" : ""}${t.amount_krw} ${BOOK_LABEL[t.book as Book]} ${t.category}`,
      ),
    );
    if (txns.length > 3) log(`    ... +${txns.length - 3}건`);
    return;
  }

  await run("bank_transaction insert", async () => {
    // 멱등성: CSV에서 import된 매출/매입 연결 거래 모두 삭제 후 재삽입
    await supabase
      .from("bank_transaction")
      .delete()
      .or("sale_id.not.is.null,purchase_id.not.is.null");
    const { error } = await supabase.from("bank_transaction").insert(txns);
    if (error) throw error;
  });
}

// ============================================================
// 5. 품목 (item) — 매출·매입 CSV에서 unique 추출
// ============================================================
type ItemKey = string; // category|spec|grade|length
interface ItemRow {
  code: string;
  name: string;
  category: string;
  rebar_spec_code: string | null;
  rebar_grade_code: string | null;
  length_m: number | null;
  spec_text: string | null;
}

function parseRebarSize(s: string | undefined): { diameter: number; lengthM: number } | null {
  if (!s) return null;
  const m = s.match(/(\d+)\s*\*\s*(\d+)/);
  if (!m) return null;
  return { diameter: Number(m[1]), lengthM: Number(m[2]) };
}

function buildItem(
  category: string,
  rawSpec: string | undefined,
  rawSize: string | undefined,
  rawGrade: string | undefined,
): ItemRow | null {
  const product = normalizeName(category);
  if (!product) return null;

  if (product === "철근") {
    // 매입은 spec='SD400', size='13*8'; 매출은 spec='13*8', size 없음
    const sizeStr = rawSize || rawSpec;
    const parsed = parseRebarSize(sizeStr);
    if (!parsed) return null;
    const grade = normalizeName(rawGrade)?.match(/^SD\d+[SW]?$/i)
      ? normalizeName(rawGrade).toUpperCase()
      : "SD400"; // 강종 미명시면 기본 SD400
    const specCode = `D${parsed.diameter}`;
    const length = parsed.lengthM;
    const code = `REBAR_${specCode}_${length}M_${grade}`;
    return {
      code,
      name: `철근 ${specCode} ${length}M ${grade}`,
      category: "rebar",
      rebar_spec_code: specCode,
      rebar_grade_code: grade,
      length_m: length,
      spec_text: null,
    };
  }

  if (product === "ㄱ앵글" || product === "앵글") {
    const size = normalizeName(rawSpec || rawSize) || "unknown";
    const code = `ANGLE_${size.replace(/\*/g, "x")}`;
    return {
      code,
      name: `ㄱ앵글 ${size}`,
      category: "etc",
      rebar_spec_code: null,
      rebar_grade_code: null,
      length_m: null,
      spec_text: `ㄱ앵글 ${size}`,
    };
  }

  // 기타 — 자유 텍스트로 저장
  const size = normalizeName(rawSpec || rawSize);
  return {
    code: `ETC_${product}_${size}`.toUpperCase().replace(/[^\w]+/g, "_"),
    name: `${product} ${size}`.trim(),
    category: "etc",
    rebar_spec_code: null,
    rebar_grade_code: null,
    length_m: null,
    spec_text: `${product} ${size}`.trim(),
  };
}

async function importItems(): Promise<Map<string, string>> {
  logSection("[5/9] 품목 (item) — 매출·매입에서 unique 추출");

  const itemsByCode = new Map<string, ItemRow>();

  const sales = loadCsv("1.매출.csv");
  for (const r of sales) {
    const item = buildItem(r["품목"], r["규격"], r["규격"], undefined);
    if (item && !itemsByCode.has(item.code)) itemsByCode.set(item.code, item);
  }

  const purchases = loadCsv("2.매입.csv");
  for (const r of purchases) {
    const item = buildItem(r["품목"], r["규격"], r["칫수"], r["규격"]);
    if (item && !itemsByCode.has(item.code)) itemsByCode.set(item.code, item);
  }

  const itemList = Array.from(itemsByCode.values());
  log(`  • 품목 ${itemList.length}종 추출 (${[...itemsByCode.keys()].slice(0, 5).join(", ")}${itemList.length > 5 ? ", ..." : ""})`);

  if (DRY_RUN) {
    const fake = new Map<string, string>();
    for (const code of itemsByCode.keys()) fake.set(code, `dry-item-${code}`);
    return fake;
  }

  await run("item upsert", async () => {
    const { error } = await supabase
      .from("item")
      .upsert(itemList, { onConflict: "code" });
    if (error) throw error;
  });

  const { data } = await supabase.from("item").select("id, code");
  const idByCode = new Map<string, string>();
  for (const i of data ?? []) idByCode.set(i.code, i.id);
  return idByCode;
}

// ============================================================
// 6. 매입 (purchase + purchase_line)
// ============================================================
async function importPurchases(
  partnerIdByName: Map<string, string>,
  itemIdByCode: Map<string, string>,
  bankIdByCode: Map<string, string>,
  warehouseId: string,
  zoneIdByBook: Record<Book, string>,
): Promise<Map<string, string>> {
  logSection("[6/9] 매입 (purchase + purchase_line)");

  const rows = loadCsv("2.매입.csv");
  const idByDocNo = new Map<string, string>();

  for (const r of rows) {
    const docNo = normalizeName(r["매입ID"]);
    const partnerName = normalizeName(r["매입처"]);
    const partnerId = await getOrCreatePartner(partnerName, partnerIdByName);
    if (!partnerId) {
      warn(`매입처 처리 불가: '${partnerName}' (doc=${docNo})`);
      continue;
    }

    const bankCode = normalizeName(r["출금통장"]);
    const book: Book = BOOK_BY_BANK_CODE[bankCode] ?? "sl";
    const item = buildItem(r["품목"], r["규격"], r["칫수"], r["규격"]);
    if (!item) {
      warn(`품목 파싱 실패: doc=${docNo}`);
      continue;
    }
    const itemId = itemIdByCode.get(item.code);
    if (!itemId) {
      warn(`item id 미발견: ${item.code}`);
      continue;
    }

    const unit = UNIT_MAP[normalizeName(r["단위"])] ?? "kg";
    const qty = parseKrw(r["수량"]);
    const weight = parseKrw(r["중량"]);
    const isDocumented = isDocumentedFromColumn(r["세금계산서수취"]);
    const taxDocType = book === "b" ? "none" : isDocumented ? "tax_invoice_electronic" : "simple_receipt";
    const subtotal = parseKrw(r["공급가(원)"]);
    const vat = parseKrw(r["부가세(원)"]);
    const total = parseKrw(r["합계(원)"]);

    const header = {
      book,
      doc_no: docNo,
      partner_id: partnerId,
      purchase_subtype: "external",
      ordered_on: r["기록일"],
      delivered_on: r["입고일자"] || null,
      is_documented: isDocumented || book !== "b" ? isDocumented : false,
      tax_doc_type: taxDocType,
      tax_doc_no: normalizeName(r["세금계산서번호"]) || null,
      vat_type: vat > 0 ? "standard_10" : "zero_rated",
      vat_rate: vat > 0 ? 10 : 0,
      subtotal_krw: subtotal,
      vat_krw: vat,
      total_krw: total,
      payment_due_on: r["결제예정일"] || null,
      // 결제완료는 "O" 마커 → 결제예정일/입고일자를 실제 paid_on 으로 사용
      paid_on: dateIfMarked(r["결제완료"], r["결제예정일"], r["입고일자"]),
      pay_bank_account_id: bankIdByCode.get(bankCode) ?? null,
      status: r["상태"]?.includes("결제완료") ? "depleted" : "in_stock",
      notes: normalizeName(r["메모"]) || null,
    };

    if (DRY_RUN) {
      log(
        `    - ${docNo} ${BOOK_LABEL[book]} ${item.name} ${qty || weight}${unit} ${total}원`,
      );
      continue;
    }

    const { data: ph, error: phErr } = await supabase
      .from("purchase")
      .upsert(header, { onConflict: "doc_no" })
      .select("id")
      .single();
    if (phErr) throw phErr;
    idByDocNo.set(docNo, ph!.id);

    // 멱등성: 이 purchase의 기존 lines 삭제 후 재삽입
    await supabase.from("purchase_line").delete().eq("purchase_id", ph!.id);

    // Line
    const acquiredQty = unit === "kg" ? weight : qty;
    const line = {
      purchase_id: ph!.id,
      book,
      warehouse_id: warehouseId,
      warehouse_zone_id: zoneIdByBook[book],
      item_id: itemId,
      acquired_unit: unit,
      acquired_qty: acquiredQty,
      unit_price_krw: parseKrw(r["단가(원)"]),
      bars_count: unit === "ea" ? qty : null,
      length_mm: item.length_m ? item.length_m * 1000 : null,
      grade: item.rebar_grade_code,
      theoretical_weight_kg: null,
      actual_weight_kg: weight || null,
      invoiced_weight_kg: weight || null,
      price_basis: unit === "kg" ? "actual" : "theoretical",
      line_subtotal_krw: subtotal,
      status: header.status,
    };
    const { error: lineErr } = await supabase.from("purchase_line").insert(line);
    if (lineErr) throw lineErr;
  }

  log(`  • 매입 ${idByDocNo.size}건 처리 완료`);
  return idByDocNo;
}

// ============================================================
// 7. 매출 (sale + sale_line)
// ============================================================
async function importSales(
  partnerIdByName: Map<string, string>,
  itemIdByCode: Map<string, string>,
  bankIdByCode: Map<string, string>,
): Promise<Map<string, string>> {
  logSection("[7/9] 매출 (sale + sale_line)");

  const rows = loadCsv("1.매출.csv");
  const idByDocNo = new Map<string, string>();

  for (const r of rows) {
    const docNo = normalizeName(r["주문ID"]);
    const partnerNameRaw = normalizeName(r["거래처"]);
    const siteName = normalizeName(r["현장"]);

    // 거래처 빈칸이면 현장명을 거래처명으로 사용 (5월 워크북 패턴)
    const lookupName = partnerNameRaw || siteName;
    if (!lookupName) {
      warn(`매출 거래처/현장 모두 비어있음: doc=${docNo}`);
      continue;
    }
    const partnerId = await getOrCreatePartner(lookupName, partnerIdByName);
    if (!partnerId) {
      warn(`매출 거래처 처리 불가: '${lookupName}' (doc=${docNo})`);
      continue;
    }

    const bankCode = normalizeName(r["입금통장"]) || normalizeName(r["사업자"]);
    const book: Book = BOOK_BY_BANK_CODE[bankCode] ?? "sl";
    const item = buildItem(r["품목"], r["규격"], undefined, undefined);
    if (!item) {
      warn(`품목 파싱 실패: doc=${docNo}`);
      continue;
    }
    const itemId = itemIdByCode.get(item.code);
    if (!itemId) {
      warn(`item id 미발견: ${item.code} (doc=${docNo})`);
      continue;
    }

    const unit = UNIT_MAP[normalizeName(r["단위"])] ?? "ea";
    const qty = parseKrw(r["수량"]);
    const subtotal = parseKrw(r["공급가(원)"]);
    const vat = parseKrw(r["부가세(원)"]);
    const total = parseKrw(r["합계(원)"]);
    const isDocumented = isDocumentedFromColumn(r["세금계산서"]);

    const header = {
      book,
      doc_no: docNo,
      partner_id: partnerId,
      site_name: siteName || null,
      sale_subtype: "external",
      ordered_on: r["기록일"],
      delivered_on: r["납품일자"] || null,
      is_documented: book === "b" ? false : isDocumented,
      tax_doc_type:
        book === "b" ? "none" : isDocumented ? "tax_invoice_electronic" : "simple_receipt",
      vat_type: vat > 0 ? "standard_10" : "zero_rated",
      vat_rate: vat > 0 ? 10 : 0,
      subtotal_krw: subtotal,
      vat_krw: vat,
      total_krw: total,
      payment_due_on: r["수금예정일"] || null,
      // 수금완료는 "O" 마커 → 수금예정일/납품일자를 실제 settled_on 으로 사용
      settled_on: dateIfMarked(r["수금완료"], r["수금예정일"], r["납품일자"]),
      receive_bank_account_id: bankIdByCode.get(bankCode) ?? null,
      status: r["상태"] === "수금완료" ? "settled" : r["상태"] === "주문" ? "reserved" : "confirmed",
      notes: normalizeName(r["메모"]) || null,
    };

    if (DRY_RUN) {
      log(
        `    - ${docNo} ${BOOK_LABEL[book]} ${item.name} ${qty}${unit} ${total}원 (${header.status})`,
      );
      continue;
    }

    const { data: sh, error: shErr } = await supabase
      .from("sale")
      .upsert(header, { onConflict: "doc_no" })
      .select("id")
      .single();
    if (shErr) throw shErr;
    idByDocNo.set(docNo, sh!.id);

    // 멱등성: 이 sale의 기존 lines 삭제 후 재삽입 (allocation도 cascade로 삭제됨)
    await supabase.from("sale_line").delete().eq("sale_id", sh!.id);

    const line = {
      sale_id: sh!.id,
      book,
      item_id: itemId,
      unit,
      qty,
      unit_price_krw: parseKrw(r["단가(원)"]),
      weight_kg: null,
      theoretical_weight_kg: null,
      price_basis: "theoretical",
      line_subtotal_krw: subtotal,
      status: header.status,
    };
    const { error: lineErr } = await supabase.from("sale_line").insert(line);
    if (lineErr) throw lineErr;
  }

  log(`  • 매출 ${idByDocNo.size}건 처리 완료`);
  return idByDocNo;
}

// ============================================================
// 8. 매출-매입 매칭 (sale_line_allocation) — 책별 FIFO
// ============================================================
async function importAllocations() {
  logSection("[8/9] 매출↔매입 매칭 (FIFO)");

  if (DRY_RUN) {
    log(`  [dry-run] FIFO 매칭 skip — 실제 실행 시 잔여 재고에서 무게 기준으로 차감`);
    return;
  }

  // 책별·품목별로 매출 라인을 시간순으로 돌면서 매입 라인 잔여분에서 차감
  // FIFO: purchase_line.created_at ASC
  // (sale.ordered_on 기준 정렬은 nested ordering이 까다로워서 sale_line.created_at으로 단순화)
  const { data: saleLines, error: slErr } = await supabase
    .from("sale_line")
    .select("id, book, item_id, qty, weight_kg, unit, unit_price_krw, line_subtotal_krw")
    .order("created_at", { ascending: true });
  if (slErr) {
    warn(`sale_line 조회 실패: ${slErr.message}`);
    return;
  }
  if (!saleLines || saleLines.length === 0) {
    log(`  • sale_line 없음 — allocation skip`);
    return;
  }

  let allocated = 0;
  for (const sl of saleLines as any[]) {
    // 잔여 매입 라인 조회 (같은 책 + 같은 품목)
    const { data: pLines } = await supabase
      .from("purchase_line")
      .select("id, acquired_qty, unit_price_krw, acquired_unit, theoretical_weight_kg, actual_weight_kg")
      .eq("book", sl.book)
      .eq("item_id", sl.item_id)
      .order("created_at", { ascending: true });

    if (!pLines || pLines.length === 0) {
      warn(`매출 라인 ${sl.id}에 매칭할 매입 라인 없음 (책=${sl.book})`);
      continue;
    }

    // 사용된 무게 조회 (각 purchase_line별)
    const pIds = pLines.map((p: any) => p.id);
    const { data: usedRows } = await supabase
      .from("sale_line_allocation")
      .select("purchase_line_id, allocated_weight_kg, allocated_qty")
      .in("purchase_line_id", pIds);
    const usedByPL = new Map<string, { w: number; q: number }>();
    for (const u of usedRows ?? []) {
      const cur = usedByPL.get(u.purchase_line_id) ?? { w: 0, q: 0 };
      cur.w += Number(u.allocated_weight_kg ?? 0);
      cur.q += Number(u.allocated_qty ?? 0);
      usedByPL.set(u.purchase_line_id, cur);
    }

    // 매출 무게 (qty 기반 추정 — 정밀 환산은 v2 수동)
    let remainingWeight = Number(sl.weight_kg ?? 0);
    let remainingQty = Number(sl.qty ?? 0);

    if (remainingWeight === 0 && remainingQty > 0) {
      // weight_kg 없으면 qty 기반 매칭 — 가닥/단위 동일 가정
    }

    for (const pl of pLines as any[]) {
      if (remainingWeight <= 0 && remainingQty <= 0) break;
      const totalWeight = Number(pl.actual_weight_kg ?? pl.theoretical_weight_kg ?? 0);
      const usedW = usedByPL.get(pl.id)?.w ?? 0;
      const usedQ = usedByPL.get(pl.id)?.q ?? 0;
      const availQty = Number(pl.acquired_qty) - usedQ;
      const availWeight = totalWeight - usedW;
      if (availQty <= 0 && availWeight <= 0) continue;

      const allocQty = remainingQty > 0 ? Math.min(remainingQty, availQty) : 0;
      const allocWeight =
        remainingWeight > 0
          ? Math.min(remainingWeight, availWeight)
          : allocQty > 0 && availQty > 0
            ? (allocQty / Number(pl.acquired_qty)) * totalWeight
            : 0;

      if (allocWeight <= 0 && allocQty <= 0) continue;

      const cost = Math.round(Number(pl.unit_price_krw) * (allocQty || allocWeight));
      await supabase.from("sale_line_allocation").insert({
        sale_line_id: sl.id,
        purchase_line_id: pl.id,
        allocated_qty: allocQty || 0,
        allocated_weight_kg: allocWeight || allocQty || 0.001, // 최소 양수
        cost_krw: cost,
      });
      allocated++;
      remainingQty -= allocQty;
      remainingWeight -= allocWeight;
    }

    if (remainingWeight > 0.001 || remainingQty > 0.001) {
      warn(`매출 라인 ${sl.id}: 잔여 미매칭 weight=${remainingWeight.toFixed(2)} qty=${remainingQty}`);
    }
  }

  log(`  • allocation ${allocated}건 생성`);
}

// ============================================================
// 9. 정기업무 + 기타 (CSV가 비어있을 수 있음)
// ============================================================
async function importRecurringTasks() {
  logSection("[9/9] 정기업무 + 기타 운영 데이터");

  const rows = loadCsv("7.정기업무.csv");
  const tasks = rows.map((r) => ({
    title: normalizeName(r["업무명"]),
    cadence: cadenceFromKorean(normalizeName(r["주기"])),
    due_rule: normalizeName(r["주기"]) || null,
    notes: normalizeName(r["메모"]) || null,
    is_active: true,
  }));

  log(`  • recurring_task ${tasks.length}건 insert 예정`);
  if (DRY_RUN) {
    tasks.slice(0, 3).forEach((t) => log(`    - ${t.title} (${t.cadence})`));
    if (tasks.length > 3) log(`    ... +${tasks.length - 3}건`);
    return;
  }

  await run("recurring_task insert", async () => {
    // 멱등성: CSV에서 import한 title은 기존 row 삭제 후 재삽입
    const titles = tasks.map((t) => t.title);
    await supabase.from("recurring_task").delete().in("title", titles);
    const { error } = await supabase.from("recurring_task").insert(tasks);
    if (error) throw error;
  });

  // 0.개선아이디어, 9.영업내역, 10.명함 — 5월 CSV 본 시점엔 비어있어 skip 가능
  for (const fname of ["0.개선아이디어.csv", "9.영업내역.csv", "10.명함.csv"]) {
    const rs = loadCsv(fname);
    if (rs.length === 0) {
      log(`  • ${fname}: 비어있음 (skip)`);
    } else {
      log(`  • ${fname}: ${rs.length}건 발견 — v2에서 매핑 추가`);
    }
  }
}

function cadenceFromKorean(s: string): string {
  if (!s) return "adhoc";
  if (s.includes("매일")) return "daily";
  if (s.includes("매주")) return "weekly";
  if (s.includes("매월")) return "monthly";
  if (s.includes("매분기")) return "quarterly";
  if (s.includes("매년") || s.includes("년")) return "yearly";
  return "adhoc";
}

// ============================================================
// 메인
// ============================================================
async function main() {
  console.log(`\n🚀 5월 워크북 → Supabase 마이그레이션`);
  console.log(`  • CSV 디렉토리: ${CSV_DIR}`);
  console.log(`  • Supabase URL: ${SUPABASE_URL ?? "(dry-run)"}`);
  console.log(`  • Dry run: ${DRY_RUN ? "예" : "아니오"}`);
  console.log(`  • Actor label: ${ACTOR_LABEL}`);
  console.log("");

  const partnerIdByName = (await importPartners()) ?? new Map();
  const { warehouseId, zoneIdByBook } = await importWarehouse();
  const bankIdByCode = (await importBankAccounts()) ?? new Map();
  const itemIdByCode = (await importItems()) ?? new Map();

  // 매입을 먼저 (매출이 매입을 차감하므로)
  const purchaseIdByDocNo = await importPurchases(
    partnerIdByName,
    itemIdByCode,
    bankIdByCode,
    warehouseId,
    zoneIdByBook,
  );
  const saleIdByDocNo = await importSales(partnerIdByName, itemIdByCode, bankIdByCode);

  // 통장 거래 (sale/purchase id가 있어야 매핑됨)
  await importBankTransactions(bankIdByCode, saleIdByDocNo, purchaseIdByDocNo);

  // FIFO 매칭
  await importAllocations();

  // 정기업무 + 기타
  await importRecurringTasks();

  console.log("\n✅ 마이그레이션 완료\n");
}

main().catch((e) => {
  console.error("\n❌ 마이그레이션 실패:", e);
  process.exit(1);
});
