import { type CompanyProfile } from "@/lib/company-profile";

export type StatementPartner = {
  name: string;
  business_no: string | null;
  representative: string | null;
  address: string | null;
};

export type StatementLine = {
  item_name: string;
  spec: string; // 규격 (D13 SD400 8M 등)
  qty_label: string; // "1톤 (941kg)" / "941 kg"
  unit_price: number; // 원/kg (또는 원/단위)
  supply: number; // 공급가액
  vat: number; // 세액
};

export type SalesStatementData = {
  doc_no: string | null;
  ordered_on: string;
  site_name: string | null;
  partner: StatementPartner;
  lines: StatementLine[];
  supply_total: number;
  vat_total: number;
  total: number;
};

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const MIN_ROWS = 8;

/** 금액 → 한글 일금 표기(간이). 백만 단위까지 충분. */
function hangulAmount(n: number): string {
  return `일금 ${fmt(n)}원정`;
}

/**
 * 거래명세서 표준 양식 — 공급받는자 보관용. A4 1매.
 * 거래명세서 ≠ 세금계산서(자료/무자료 무관 거래 증빙).
 */
export function SalesStatement({
  data,
  company,
}: {
  data: SalesStatementData;
  company: CompanyProfile | null;
}) {
  if (!company) {
    return (
      <div className="rounded-md border-2 border-amber-500/60 bg-amber-50 p-6 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <h2 className="font-semibold">회사 정보 미설정</h2>
        <p className="mt-2 text-sm">
          공급자 정보가 등록되지 않았습니다. <strong>설정 → 회사 정보</strong>에서 먼저 등록해주세요.
        </p>
      </div>
    );
  }

  const filled = [
    ...data.lines,
    ...Array.from({ length: Math.max(0, MIN_ROWS - data.lines.length) }, () => null),
  ];
  const th = "border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium";
  const td = "border border-zinc-700 px-2 py-1";

  return (
    <article className="sales-statement text-xs text-zinc-900 print:text-[10pt]">
      {/* 제목 */}
      <header className="mb-3 flex items-center justify-between border-b-2 border-zinc-900 pb-1">
        <div className="font-mono text-[10px] text-zinc-500">{data.doc_no ?? "(작성중)"}</div>
        <h1 className="text-center text-2xl font-bold tracking-[0.4em]">거&nbsp;래&nbsp;명&nbsp;세&nbsp;서</h1>
        <div className="text-[10px] text-zinc-500">공급받는자 보관용</div>
      </header>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px]">작성일자: <strong>{data.ordered_on}</strong></span>
        {data.site_name ? <span className="text-[11px]">현장: <strong>{data.site_name}</strong></span> : null}
      </div>

      {/* 공급받는자 / 공급자 좌우 */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        {/* 공급받는자 (거래처) */}
        <table className="w-full border-collapse border border-zinc-700">
          <colgroup>
            <col style={{ width: "26%" }} />
            <col />
          </colgroup>
          <tbody>
            <tr>
              <th className={th} rowSpan={4}>공급<br />받는자</th>
              <td className={td}>
                <span className="text-[10px] text-zinc-500">등록번호 </span>
                {data.partner.business_no ?? "—"}
              </td>
            </tr>
            <tr>
              <td className={td}>
                <span className="text-[10px] text-zinc-500">상호 </span>
                <strong>{data.partner.name}</strong>
                <span className="ml-2 text-[10px] text-zinc-500">성명 </span>
                {data.partner.representative ?? "—"}
              </td>
            </tr>
            <tr>
              <td className={td}>
                <span className="text-[10px] text-zinc-500">주소 </span>
                {data.partner.address ?? "—"}
              </td>
            </tr>
            <tr>
              <td className={`${td} text-zinc-400`}>&nbsp;</td>
            </tr>
          </tbody>
        </table>

        {/* 공급자 (우리) */}
        <table className="w-full border-collapse border border-zinc-700">
          <colgroup>
            <col style={{ width: "26%" }} />
            <col />
          </colgroup>
          <tbody>
            <tr>
              <th className={th} rowSpan={4}>공급자</th>
              <td className={td}>
                <span className="text-[10px] text-zinc-500">등록번호 </span>
                {company.business_no}
              </td>
            </tr>
            <tr>
              <td className={td}>
                <span className="text-[10px] text-zinc-500">상호 </span>
                <strong>{company.name}</strong>
                <span className="ml-2 text-[10px] text-zinc-500">성명 </span>
                {company.representative ?? "—"}
              </td>
            </tr>
            <tr>
              <td className={td}>
                <span className="text-[10px] text-zinc-500">주소 </span>
                {company.address ?? "—"}
              </td>
            </tr>
            <tr>
              <td className={td}>
                <span className="text-[10px] text-zinc-500">업태/종목 </span>
                {company.business_type ?? "—"} / {company.business_item ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 합계금액 강조 */}
      <div className="mb-2 flex items-center justify-between border border-zinc-700 bg-zinc-100 px-3 py-1.5">
        <span className="font-semibold">합계금액</span>
        <span className="text-base font-bold tabular-nums">
          {hangulAmount(data.total)} <span className="text-zinc-500">(₩{fmt(data.total)})</span>
        </span>
      </div>

      {/* 거래내역 표 */}
      <table className="w-full border-collapse border-2 border-zinc-900 text-[11px]">
        <thead className="bg-zinc-100">
          <tr>
            <th className="border border-zinc-700 px-1 py-1 w-12">월일</th>
            <th className="border border-zinc-700 px-1 py-1">품&nbsp;목</th>
            <th className="border border-zinc-700 px-1 py-1 w-28">규&nbsp;격</th>
            <th className="border border-zinc-700 px-1 py-1 w-24">수&nbsp;량</th>
            <th className="border border-zinc-700 px-1 py-1 w-20">단가</th>
            <th className="border border-zinc-700 px-1 py-1 w-24">공급가액</th>
            <th className="border border-zinc-700 px-1 py-1 w-20">세액</th>
          </tr>
        </thead>
        <tbody>
          {filled.map((line, i) =>
            line ? (
              <tr key={i}>
                <td className="border border-zinc-700 px-1 py-0.5 text-center text-[10px]">
                  {(() => {
                    const d = new Date(data.ordered_on);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  })()}
                </td>
                <td className="border border-zinc-700 px-1 py-0.5">{line.item_name}</td>
                <td className="border border-zinc-700 px-1 py-0.5 text-center">{line.spec}</td>
                <td className="border border-zinc-700 px-1 py-0.5 text-right tabular-nums">{line.qty_label}</td>
                <td className="border border-zinc-700 px-1 py-0.5 text-right tabular-nums">{fmt(line.unit_price)}</td>
                <td className="border border-zinc-700 px-1 py-0.5 text-right tabular-nums">{fmt(line.supply)}</td>
                <td className="border border-zinc-700 px-1 py-0.5 text-right tabular-nums">{fmt(line.vat)}</td>
              </tr>
            ) : (
              <tr key={i}>
                {Array.from({ length: 7 }).map((_, c) => (
                  <td key={c} className="border border-zinc-700 px-1 py-0.5 h-5">&nbsp;</td>
                ))}
              </tr>
            ),
          )}
        </tbody>
        <tfoot className="bg-zinc-100 font-semibold">
          <tr>
            <td colSpan={5} className="border-2 border-zinc-900 px-2 py-1 text-right">합&nbsp;&nbsp;계</td>
            <td className="border-2 border-zinc-900 px-1 py-1 text-right tabular-nums">{fmt(data.supply_total)}</td>
            <td className="border-2 border-zinc-900 px-1 py-1 text-right tabular-nums">{fmt(data.vat_total)}</td>
          </tr>
        </tfoot>
      </table>

      {/* 입금계좌 + 인수 */}
      <div className="mt-3 flex items-end justify-between">
        <div className="text-[11px]">
          {company.bank_default_name || company.bank_default_no ? (
            <p>
              <span className="text-zinc-500">입금계좌 </span>
              {company.bank_default_name ?? ""} {company.bank_default_no ?? ""}
            </p>
          ) : null}
          {company.phone || company.mobile ? (
            <p className="text-[10px] text-zinc-500">
              연락처 {company.phone ?? ""}{company.mobile ? ` · ${company.mobile}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          인수자
          <span className="inline-block w-24 border-b border-zinc-700">&nbsp;</span>
          <span className="text-zinc-400">(인)</span>
        </div>
      </div>
    </article>
  );
}
