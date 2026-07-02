import { type CompanyProfile } from "@/lib/company-profile";
import { type StatementData, toKoreanAmount } from "@/components/admin/trading-statement";
import { formatBusinessNo } from "@/lib/format";

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const MIN_ROWS = 4; // 빈 행으로 표 높이 유지

/**
 * 전자세금계산서 양식(공급받는자 보관용 1매) — 발행 전 미리보기·사내 출력용.
 * 법적 원본은 ASP(팝빌)에서 발급하는 PDF. 데이터는 거래명세표(StatementData) + 회사정보 재사용.
 * 철근은 거래명세표와 동일하게 '철근' 라벨(+규격)로 표기, display_name 오버라이드 반영.
 */
export function TaxInvoiceDocument({
  data,
  company,
  ntsConfirmNum,
  purpose = "charge",
  writeDate,
}: {
  data: StatementData;
  company: CompanyProfile | null;
  ntsConfirmNum?: string | null;
  purpose?: "charge" | "receipt";
  writeDate?: string | null;
}) {
  if (!company) {
    return (
      <div className="rounded-md border-2 border-amber-500/60 bg-amber-50 p-6 text-amber-800">
        <h2 className="font-semibold">회사 정보 미설정</h2>
        <p className="mt-2 text-sm">
          공급자 정보가 없습니다. <strong>설정 → 회사 정보</strong>에서 먼저 등록해주세요.
        </p>
      </div>
    );
  }

  const wDate = writeDate ?? data.ordered_on;
  const d = new Date(wDate);
  const lines = data.lines;
  const filled = [...lines, ...Array.from({ length: Math.max(0, MIN_ROWS - lines.length) }, () => null)];
  const base = "border-red-700";

  return (
    <div className="tax-invoice-print text-xs text-zinc-900">
      <article className={`border-2 ${base} p-3 print:p-2`}>
        {/* 제목 + 승인번호 */}
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] text-zinc-500">{ntsConfirmNum ? `승인번호 ${ntsConfirmNum}` : "미발행(미리보기)"}</div>
          <h2 className="text-center text-lg font-bold tracking-wider text-red-700">
            세 금 계 산 서
            <span className="ml-2 text-sm font-normal">(공급받는자 보관용)</span>
          </h2>
          <div className="text-[10px] text-zinc-500">{purpose === "receipt" ? "영수" : "청구"}</div>
        </div>

        {/* 공급자 / 공급받는자 */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <PartyTable
            title="공급자"
            regNo={company.business_no}
            name={company.name}
            ceo={company.representative}
            addr={company.address}
            bizType={company.business_type}
            bizClass={company.business_item}
            email={company.email}
          />
          <PartyTable
            title="공급받는자"
            regNo={data.partner.business_no}
            name={data.partner.name}
            ceo={data.partner.representative}
            addr={data.partner.address}
            bizType={data.partner.industry}
            bizClass={null}
            email={data.partner.email ?? null}
          />
        </div>

        {/* 작성일자 · 공급가액 · 세액 */}
        <table className={`mt-2 w-full border-collapse border ${base} text-center`}>
          <thead className="bg-red-50">
            <tr>
              <th className={`border ${base} px-1 py-1`}>작 성 일 자</th>
              <th className={`border ${base} px-1 py-1`}>공 급 가 액</th>
              <th className={`border ${base} px-1 py-1`}>세 액</th>
              <th className={`border ${base} px-1 py-1`}>비 고</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={`border ${base} px-1 py-1 font-mono`}>{wDate}</td>
              <td className={`border ${base} px-1 py-1 text-right tabular-nums`}>{fmt(data.subtotal_krw)}</td>
              <td className={`border ${base} px-1 py-1 text-right tabular-nums`}>{fmt(data.vat_krw)}</td>
              <td className={`border ${base} px-1 py-1`}>{data.notes ?? ""}</td>
            </tr>
          </tbody>
        </table>

        {/* 합계금액(한글) */}
        <div className={`mt-2 flex items-center justify-between gap-3 border ${base} bg-red-50 px-3 py-2`}>
          <span className="text-sm font-medium">
            <span className="font-semibold">합계금액 :</span> {toKoreanAmount(data.total_krw)}원 정
          </span>
          <span className="whitespace-nowrap text-right text-lg font-bold tabular-nums text-red-700">
            ₩{fmt(data.total_krw)}
          </span>
        </div>

        {/* 품목 표 */}
        <table className={`mt-2 w-full border-collapse border ${base}`}>
          <thead className="bg-red-50">
            <tr>
              <th className={`border ${base} px-1 py-1 w-10`}>월/일</th>
              <th className={`border ${base} px-1 py-1`}>품 목</th>
              <th className={`border ${base} px-1 py-1 w-24`}>규 격</th>
              <th className={`border ${base} px-1 py-1 w-14`}>수 량</th>
              <th className={`border ${base} px-1 py-1 w-20`}>단 가</th>
              <th className={`border ${base} px-1 py-1 w-24`}>공급가액</th>
              <th className={`border ${base} px-1 py-1 w-20`}>세 액</th>
            </tr>
          </thead>
          <tbody>
            {filled.map((line, i) =>
              line ? (
                <tr key={i}>
                  <td className={`border ${base} px-1 py-0.5 text-center`}>
                    {i === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : ""}
                  </td>
                  <td className={`border ${base} px-1 py-0.5`}>
                    {line.display_name ?? (line.spec ? "철근" : line.item_name)}
                  </td>
                  <td className={`border ${base} px-1 py-0.5 text-center`}>{line.spec}</td>
                  <td className={`border ${base} px-1 py-0.5 text-right tabular-nums`}>
                    {line.qty} {line.unit}
                  </td>
                  <td className={`border ${base} px-1 py-0.5 text-right tabular-nums`}>{line.unit_price_krw > 0 ? fmt(line.unit_price_krw) : "-"}</td>
                  <td className={`border ${base} px-1 py-0.5 text-right tabular-nums`}>{fmt(line.subtotal_krw)}</td>
                  <td className={`border ${base} px-1 py-0.5 text-right tabular-nums`}>{fmt(line.vat_krw)}</td>
                </tr>
              ) : (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, c) => (
                    <td key={c} className={`border ${base} px-1 py-0.5 h-5`}>
                      &nbsp;
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>

        <div className="mt-1 text-right text-[10px] text-zinc-500">
          ※ 법적 원본은 국세청 전자세금계산서(ASP 발급 PDF)입니다 — 본 양식은 내부 확인용.
        </div>
      </article>
    </div>
  );
}

function PartyTable({
  title,
  regNo,
  name,
  ceo,
  addr,
  bizType,
  bizClass,
  email,
}: {
  title: string;
  regNo: string | null;
  name: string;
  ceo: string | null;
  addr: string | null;
  bizType: string | null;
  bizClass: string | null;
  email: string | null;
}) {
  const base = "border-red-700";
  const th = `border ${base} bg-red-50 px-1 py-0.5 text-center text-[10px] font-medium`;
  const td = `border ${base} px-1 pl-2 py-0.5 text-[11px]`;
  return (
    <table className={`w-full border table-fixed ${base}`}>
      <caption className={`border ${base} bg-red-100 py-0.5 text-[11px] font-semibold`}>{title}</caption>
      <colgroup>
        <col style={{ width: "22%" }} />
        <col />
        <col style={{ width: "16%" }} />
        <col />
      </colgroup>
      <tbody>
        <tr>
          <th className={th}>등록번호</th>
          <td className={td} colSpan={3}>
            {formatBusinessNo(regNo) || " "}
          </td>
        </tr>
        <tr>
          <th className={th}>상호</th>
          <td className={td}>{name || " "}</td>
          <th className={th}>성명</th>
          <td className={td}>{ceo || " "}</td>
        </tr>
        <tr>
          <th className={th}>사업장주소</th>
          <td className={td} colSpan={3}>
            {addr || " "}
          </td>
        </tr>
        <tr>
          <th className={th}>업태</th>
          <td className={td}>{bizType || " "}</td>
          <th className={th}>종목</th>
          <td className={td}>{bizClass || " "}</td>
        </tr>
        <tr>
          <th className={th}>이메일</th>
          <td className={td} colSpan={3}>
            {email || " "}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
