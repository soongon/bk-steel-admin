import { type CompanyProfile } from "@/lib/company-profile";
import { type DeliveryCertificate } from "@/lib/delivery-certificate";

export type DeliveryCertPartner = {
  name: string;
  business_no: string | null;
  representative: string | null;
  address: string | null;
};

export type DeliveryCertSite = {
  code: string;
  name: string;
  address: string | null;
  client_name: string | null;       // 시공사
  owner_name: string | null;        // 건축주 (관급은 사업명)
  owner_address: string | null;     // 건축주·발주청 주소
};

export type DeliveryCertLine = {
  ordered_on: string;
  item_name: string;
  spec: string;
  qty: number;
  unit: string;
  weight_kg?: number | null;
  subtotal_krw?: number;
  doc_no?: string;
};

export type DeliveryCertData = {
  cert: DeliveryCertificate | null;        // null = 미발급 미리보기
  partner: DeliveryCertPartner;
  site: DeliveryCertSite | null;            // 현장 미지정 가능
  lines: DeliveryCertLine[];
  total_qty_summary: string;                 // 단위가 섞일 수 있어 문자열로
  total_weight_kg: number;
  total_krw: number;
  period_from: string;
  period_to: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const fmtKrw = (n: number) => `₩${fmt(n)}`;

const MIN_ROWS = 10;

/**
 * 납품확인서 표준 양식 — A4 1매 기준.
 * 거래처+현장 단위로 1회 발급 (도메인 룰). 준공검사 첨부.
 * 인감은 v1.1 (company.stamp_url) — 현재는 placeholder 박스.
 */
export function DeliveryCertForm({
  data,
  company,
}: {
  data: DeliveryCertData;
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

  const docNo = data.cert?.doc_no ?? "(미발급)";
  const issuedOn = data.cert?.issued_on ?? new Date().toISOString().slice(0, 10);

  return (
    <article className="delivery-cert text-xs text-zinc-900 print:text-[10pt]">
      {/* 제목 */}
      <header className="mb-3 flex items-center justify-between border-b-2 border-zinc-900 pb-1">
        <div className="font-mono text-[10px] text-zinc-500">{docNo}</div>
        <h1 className="text-center text-2xl font-bold tracking-[0.5em]">
          납&nbsp;품&nbsp;확&nbsp;인&nbsp;서
        </h1>
        <div className="text-[10px] text-zinc-500">
          발급일 {issuedOn}
        </div>
      </header>

      {/* 수신 (거래처) — 단순 1-row */}
      <div className="mb-3">
        <table className="w-full border-collapse border border-zinc-700">
          <colgroup>
            <col style={{ width: "12%" }} />
            <col />
            <col style={{ width: "12%" }} />
            <col />
          </colgroup>
          <tbody>
            <tr>
              <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                수&nbsp;신
              </th>
              <td className="border border-zinc-700 px-3 py-1 font-semibold" colSpan={3}>
                {data.partner.name} 귀하
              </td>
            </tr>
            <tr>
              <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                등록번호
              </th>
              <td className="border border-zinc-700 px-3 py-1">
                {data.partner.business_no ?? "—"}
              </td>
              <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                대표자
              </th>
              <td className="border border-zinc-700 px-3 py-1">
                {data.partner.representative ?? "—"}
              </td>
            </tr>
            <tr>
              <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                주&nbsp;소
              </th>
              <td className="border border-zinc-700 px-3 py-1" colSpan={3}>
                {data.partner.address ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 현장·건축주 정보 */}
      {data.site ? (
        <div className="mb-3">
          <table className="w-full border-collapse border border-zinc-700">
            <colgroup>
              <col style={{ width: "12%" }} />
              <col />
              <col style={{ width: "12%" }} />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                  현&nbsp;장
                </th>
                <td className="border border-zinc-700 px-3 py-1 font-semibold">
                  {data.site.name}
                  <span className="ml-2 font-mono text-[10px] text-zinc-500">
                    {data.site.code}
                  </span>
                </td>
                <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                  시공사
                </th>
                <td className="border border-zinc-700 px-3 py-1">
                  {data.site.client_name ?? "—"}
                </td>
              </tr>
              <tr>
                <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                  현장주소
                </th>
                <td className="border border-zinc-700 px-3 py-1" colSpan={3}>
                  {data.site.address ?? "—"}
                </td>
              </tr>
              <tr>
                <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                  건축주
                </th>
                <td className="border border-zinc-700 px-3 py-1 font-semibold" colSpan={3}>
                  {data.site.owner_name ?? (
                    <span className="text-zinc-400">(미등록)</span>
                  )}
                </td>
              </tr>
              <tr>
                <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                  건축주주소
                </th>
                <td className="border border-zinc-700 px-3 py-1" colSpan={3}>
                  {data.site.owner_address ?? (
                    <span className="text-zinc-400">(미등록)</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 본문 */}
      <p className="mb-2 text-center text-sm">
        당사는 아래와 같이 위 현장에 자재를 <strong>{data.period_from}</strong>
        {data.period_from !== data.period_to ? (
          <> 부터 <strong>{data.period_to}</strong> 까지</>
        ) : null}
        {" "}
        납품하였음을 확인합니다.
      </p>

      {/* 납품 내역 표 */}
      <table className="w-full border-collapse border-2 border-zinc-900 text-[11px]">
        <thead className="bg-zinc-100">
          <tr>
            <th className="border border-zinc-700 px-1 py-1 w-14">납품일</th>
            <th className="border border-zinc-700 px-1 py-1">품&nbsp;목</th>
            <th className="border border-zinc-700 px-1 py-1 w-28">규&nbsp;격</th>
            <th className="border border-zinc-700 px-1 py-1 w-20">수&nbsp;량</th>
            <th className="border border-zinc-700 px-1 py-1 w-20">중량(kg)</th>
            <th className="border border-zinc-700 px-1 py-1 w-24">금액</th>
            <th className="border border-zinc-700 px-1 py-1 w-20">매출번호</th>
          </tr>
        </thead>
        <tbody>
          {filled.map((line, i) =>
            line ? (
              <tr key={i}>
                <td className="border border-zinc-700 px-1 py-0.5 text-center text-[10px]">
                  {(() => {
                    const d = new Date(line.ordered_on);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  })()}
                </td>
                <td className="border border-zinc-700 px-1 py-0.5">{line.item_name}</td>
                <td className="border border-zinc-700 px-1 py-0.5 text-center">{line.spec}</td>
                <td className="border border-zinc-700 px-1 py-0.5 text-right tabular-nums">
                  {fmt(line.qty)} {line.unit}
                </td>
                <td className="border border-zinc-700 px-1 py-0.5 text-right tabular-nums">
                  {line.weight_kg ? fmt(line.weight_kg) : ""}
                </td>
                <td className="border border-zinc-700 px-1 py-0.5 text-right tabular-nums">
                  {line.subtotal_krw != null ? fmt(line.subtotal_krw) : ""}
                </td>
                <td className="border border-zinc-700 px-1 py-0.5 text-center font-mono text-[10px]">
                  {line.doc_no ?? ""}
                </td>
              </tr>
            ) : (
              <tr key={i}>
                {Array.from({ length: 7 }).map((_, c) => (
                  <td key={c} className="border border-zinc-700 px-1 py-0.5 h-5">
                    &nbsp;
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
        <tfoot className="bg-zinc-100 font-semibold">
          <tr>
            <td colSpan={3} className="border-2 border-zinc-900 px-2 py-1 text-right">
              합&nbsp;&nbsp;계
            </td>
            <td className="border-2 border-zinc-900 px-1 py-1 text-right tabular-nums">
              {data.total_qty_summary}
            </td>
            <td className="border-2 border-zinc-900 px-1 py-1 text-right tabular-nums">
              {data.total_weight_kg ? fmt(data.total_weight_kg) : ""}
            </td>
            <td className="border-2 border-zinc-900 px-1 py-1 text-right tabular-nums">
              {fmtKrw(data.total_krw)}
            </td>
            <td className="border-2 border-zinc-900 px-1 py-1 text-center">
              {data.lines.length}건
            </td>
          </tr>
        </tfoot>
      </table>

      {/* 공급자 (우리) + 인감 */}
      <section className="mt-6">
        <p className="mb-3 text-center text-sm font-medium">
          위와 같이 납품하였음을 확인합니다.
        </p>
        <p className="mb-4 text-center text-base font-semibold tracking-widest">
          {issuedOn.replaceAll("-", ". ")}
        </p>

        <table className="ml-auto w-2/3 border-collapse border border-zinc-700">
          <colgroup>
            <col style={{ width: "20%" }} />
            <col />
            <col style={{ width: "20%" }} />
            <col style={{ width: "22%" }} />
          </colgroup>
          <tbody>
            <tr>
              <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                공급자
              </th>
              <td className="border border-zinc-700 px-3 py-1 font-semibold">
                {company.name}
              </td>
              <th
                rowSpan={4}
                className="border border-zinc-700 bg-zinc-50 px-2 py-1 text-center align-middle font-medium"
              >
                직인
              </th>
              <td
                rowSpan={4}
                className="border-2 border-dashed border-zinc-400 bg-zinc-50 px-2 py-1 align-middle text-center text-[10px] text-zinc-400"
              >
                (인감 v1.1)
              </td>
            </tr>
            <tr>
              <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                등록번호
              </th>
              <td className="border border-zinc-700 px-3 py-1 font-mono">
                {company.business_no}
              </td>
            </tr>
            <tr>
              <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                대표자
              </th>
              <td className="border border-zinc-700 px-3 py-1">
                {company.representative ?? "—"}
              </td>
            </tr>
            <tr>
              <th className="border border-zinc-700 bg-zinc-100 px-2 py-1 text-center font-medium">
                주&nbsp;소
              </th>
              <td className="border border-zinc-700 px-3 py-1 text-[10px]">
                {company.address ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </article>
  );
}
