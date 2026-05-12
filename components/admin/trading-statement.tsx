import { type CompanyProfile } from "@/lib/company-profile";

export type StatementLine = {
  item_name: string;
  spec: string;
  qty: number;
  unit: string;
  unit_price_krw: number;
  subtotal_krw: number;
  vat_krw: number;
  weight_kg?: number | null;
  note?: string;
};

export type StatementData = {
  doc_no: string;
  ordered_on: string; // YYYY-MM-DD
  tax_doc_no?: string | null;
  partner: {
    name: string;
    business_no: string | null;
    representative: string | null;
    address: string | null;
    phone: string | null;
    fax: string | null;
    industry: string | null;
  };
  site_name: string | null;
  is_documented: boolean;
  lines: StatementLine[];
  subtotal_krw: number;
  vat_krw: number;
  total_krw: number;
  notes: string | null;
};

const fmtKrw = (n: number) => Math.round(n).toLocaleString("ko-KR");
const fmtKrwSym = (n: number) => `₩${fmtKrw(n)}`;

const MIN_ROWS = 8; // 빈 행으로 표 높이 유지

/**
 * 한국 표준 거래명세표 — A4 세로 한 페이지에 두 카피.
 * 위: 공급받는자 보관용 (파란색)
 * 아래: 공급자 보관용 (빨간색)
 */
export function TradingStatement({
  data,
  company,
}: {
  data: StatementData;
  company: CompanyProfile | null;
}) {
  if (!company) {
    return (
      <div className="rounded-md border-2 border-amber-500/60 bg-amber-50 p-6 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <h2 className="font-semibold">회사 정보 미설정</h2>
        <p className="mt-2 text-sm">
          이 책의 공급자 정보가 등록되지 않았습니다. <strong>설정 → 회사 정보</strong>에서 먼저 등록해주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="statement-print flex flex-col gap-6 print:gap-3">
      {/* B계좌·무자료 거래 시 명세서 상단에 안내 (인쇄 시 보이도록) */}
      {!data.is_documented ? (
        <div className="rounded-md border border-amber-500/60 bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-800 print:py-1 print:text-[9pt]">
          <strong>무자료 거래</strong> — 세금계산서 미발행 (부가세 신고 대상 아님)
        </div>
      ) : null}
      <StatementCopy data={data} company={company} variant="recipient" />
      <div className="relative h-0 border-t-2 border-dashed border-zinc-400 print:border-zinc-600">
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-[10px] text-muted-foreground print:bg-white">
          ✂ 절취선 (보관용 분리)
        </span>
      </div>
      <StatementCopy data={data} company={company} variant="supplier" />
    </div>
  );
}

function StatementCopy({
  data,
  company,
  variant,
}: {
  data: StatementData;
  company: CompanyProfile;
  variant: "recipient" | "supplier";
}) {
  const isRec = variant === "recipient";
  const baseClass = isRec ? "border-blue-700 text-blue-900" : "border-red-700 text-red-900";
  const headClass = isRec
    ? "bg-blue-50 dark:bg-blue-950/20"
    : "bg-red-50 dark:bg-red-950/20";
  const titleClass = isRec ? "text-blue-700" : "text-red-700";

  const dateObj = new Date(data.ordered_on);
  const dateMonth = dateObj.getMonth() + 1;
  const dateDay = dateObj.getDate();

  // 표 최소 행 채우기 (빈 행)
  const filledLines = [
    ...data.lines,
    ...Array.from({ length: Math.max(0, MIN_ROWS - data.lines.length) }, () => null),
  ];

  return (
    <article
      className={`statement-copy border-2 ${baseClass} p-3 text-xs print:p-2 print:text-[10pt]`}
    >
      {/* 제목 */}
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-zinc-500">{data.doc_no}</div>
        <h2 className={`text-center text-lg font-bold tracking-wider ${titleClass}`}>
          거래명세표
          <span className="ml-2 text-sm font-normal">
            ({isRec ? "공급받는자 보관용" : "공급자 보관용"})
          </span>
        </h2>
        <div className="text-xs text-zinc-500">
          {dateMonth}월 {dateDay}일
        </div>
      </div>

      {/* 양측 사업자 정보 */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {/* 공급받는자 */}
        <table className={`w-full border ${baseClass}`}>
          <tbody>
            <PartyRow label="등 록 번 호" value={data.partner.business_no} variant={variant} />
            <PartyRow label="상   호" value={data.partner.name} variant={variant} bold />
            <PartyRow
              label="대 표 자"
              value={data.partner.representative ?? ""}
              variant={variant}
            />
            <PartyRow label="사업장주소" value={data.partner.address ?? ""} variant={variant} />
            <PartyRow
              label="업태 / 종목"
              value={data.partner.industry ?? ""}
              variant={variant}
            />
            <PartyDoubleRow
              label1="전 화"
              value1={data.partner.phone}
              label2="F A X"
              value2={data.partner.fax}
              variant={variant}
            />
          </tbody>
        </table>

        {/* 공급자 (우리) */}
        <table className={`w-full border ${baseClass}`}>
          <tbody>
            <PartyRow label="등 록 번 호" value={company.business_no} variant={variant} />
            <PartyRow label="상   호" value={company.name} variant={variant} bold />
            <PartyRow
              label="대 표 자"
              value={`${company.representative ?? ""}  (인)`}
              variant={variant}
            />
            <PartyRow label="사업장주소" value={company.address} variant={variant} />
            <PartyRow
              label="업태 / 종목"
              value={[company.business_type, company.business_item].filter(Boolean).join(" / ")}
              variant={variant}
            />
            <PartyDoubleRow
              label1="전 화"
              value1={company.phone}
              label2="F A X"
              value2={company.fax}
              variant={variant}
            />
          </tbody>
        </table>
      </div>

      {/* 현장 / 인사말 */}
      <div className={`mt-2 ${headClass} px-2 py-1 text-center text-xs ${baseClass} border`}>
        {data.site_name ? (
          <>
            <span className="font-semibold">현장:</span> {data.site_name}
            <span className="mx-2">·</span>
          </>
        ) : null}
        위와 같이 계산합니다. 감사합니다.
      </div>

      {/* 라인 표 */}
      <table className={`mt-2 w-full border-collapse border ${baseClass}`}>
        <thead className={`${headClass}`}>
          <tr>
            <th className={`border ${baseClass} px-1 py-1 w-10`}>월/일</th>
            <th className={`border ${baseClass} px-1 py-1`}>품 목</th>
            <th className={`border ${baseClass} px-1 py-1 w-24`}>규 격</th>
            <th className={`border ${baseClass} px-1 py-1 w-16`}>수 량</th>
            <th className={`border ${baseClass} px-1 py-1 w-20`}>단 가</th>
            <th className={`border ${baseClass} px-1 py-1 w-24`}>공급가액</th>
            <th className={`border ${baseClass} px-1 py-1 w-20`}>세 액</th>
            <th className={`border ${baseClass} px-1 py-1 w-14`}>비 고</th>
          </tr>
        </thead>
        <tbody>
          {filledLines.map((line, i) =>
            line ? (
              <tr key={i}>
                <td className={`border ${baseClass} px-1 py-0.5 text-center text-xs`}>
                  {dateMonth}/{dateDay}
                </td>
                <td className={`border ${baseClass} px-1 py-0.5`}>{line.item_name}</td>
                <td className={`border ${baseClass} px-1 py-0.5 text-center text-xs`}>
                  {line.spec}
                </td>
                <td className={`border ${baseClass} px-1 py-0.5 text-right tabular-nums`}>
                  {line.qty} {line.unit}
                </td>
                <td className={`border ${baseClass} px-1 py-0.5 text-right tabular-nums`}>
                  {fmtKrw(line.unit_price_krw)}
                </td>
                <td className={`border ${baseClass} px-1 py-0.5 text-right tabular-nums`}>
                  {fmtKrw(line.subtotal_krw)}
                </td>
                <td className={`border ${baseClass} px-1 py-0.5 text-right tabular-nums`}>
                  {data.is_documented ? fmtKrw(line.vat_krw) : "—"}
                </td>
                <td className={`border ${baseClass} px-1 py-0.5 text-center text-[10px]`}>
                  {line.weight_kg ? `${Math.round(line.weight_kg).toLocaleString()}kg` : ""}
                </td>
              </tr>
            ) : (
              <tr key={i}>
                {Array.from({ length: 8 }).map((_, c) => (
                  <td key={c} className={`border ${baseClass} px-1 py-0.5 h-5`}>
                    &nbsp;
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
        <tfoot className={`${headClass} font-semibold`}>
          <tr>
            <td colSpan={5} className={`border ${baseClass} px-2 py-1 text-right`}>
              소 계
            </td>
            <td className={`border ${baseClass} px-1 py-1 text-right tabular-nums`}>
              {fmtKrw(data.subtotal_krw)}
            </td>
            <td className={`border ${baseClass} px-1 py-1 text-right tabular-nums`}>
              {data.is_documented ? fmtKrw(data.vat_krw) : "—"}
            </td>
            <td className={`border ${baseClass}`}></td>
          </tr>
          <tr>
            <td colSpan={5} className={`border ${baseClass} px-2 py-1 text-right`}>
              합 계 금 액
            </td>
            <td
              colSpan={3}
              className={`border ${baseClass} px-2 py-1 text-right text-base tabular-nums`}
            >
              {fmtKrwSym(data.total_krw)}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* 인수자 / 비고 */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div className={`col-span-2 border ${baseClass} px-2 py-1`}>
          <span className="text-muted-foreground">비 고: </span>
          {data.notes ?? ""}
        </div>
        <div className={`border ${baseClass} px-2 py-1 text-center`}>
          인 수 자: ______________ (인)
        </div>
      </div>
    </article>
  );
}

function PartyRow({
  label,
  value,
  variant,
  bold,
}: {
  label: string;
  value: string | null | React.ReactNode;
  variant: "recipient" | "supplier";
  bold?: boolean;
}) {
  const isRec = variant === "recipient";
  const headClass = isRec
    ? "bg-blue-50 text-blue-900 dark:bg-blue-950/20"
    : "bg-red-50 text-red-900 dark:bg-red-950/20";
  const baseClass = isRec ? "border-blue-700" : "border-red-700";
  return (
    <tr>
      <th
        className={`border ${baseClass} ${headClass} px-1 py-0.5 text-left text-[10px] font-medium w-20`}
      >
        {label}
      </th>
      <td className={`border ${baseClass} px-1 py-0.5 text-xs ${bold ? "font-semibold" : ""}`}>
        {value || " "}
      </td>
    </tr>
  );
}
