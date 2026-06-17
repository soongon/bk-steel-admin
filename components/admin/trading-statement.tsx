import { type CompanyProfile } from "@/lib/company-profile";
import { formatBusinessNo, formatPhone } from "@/lib/format";

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
  ordered_on?: string;  // 누적 명세표에서 라인별 날짜 표시용 (단건은 헤더의 ordered_on 사용)
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

/** 숫자 → 한글 금액 (예: 1956240 → 일백구십오만육천이백사십). 거래명세표·견적서 격식 표기. */
export function toKoreanAmount(n: number): string {
  const num = Math.floor(Math.abs(n));
  if (num === 0) return "영";
  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const small = ["", "십", "백", "천"];
  const big = ["", "만", "억", "조", "경"];
  const groups: string[] = [];
  let s = String(num);
  while (s.length > 0) {
    groups.unshift(s.slice(-4));
    s = s.slice(0, -4);
  }
  let out = "";
  groups.forEach((g, gi) => {
    if (parseInt(g, 10) === 0) return;
    const ds = g.padStart(4, "0").split("").map(Number);
    let part = "";
    ds.forEach((d, di) => {
      if (d !== 0) part += digits[d] + small[3 - di];
    });
    out += part + big[groups.length - 1 - gi];
  });
  return out;
}

const MIN_ROWS = 8; // 빈 행으로 표 높이 유지

/**
 * 한국 표준 거래명세표 — A4 세로 한 페이지에 두 카피.
 * 위: 공급받는자 보관용 (파란색)
 * 아래: 공급자 보관용 (빨간색)
 */
export function TradingStatement({
  data,
  company,
  recipientOnly = false,
  mode = "statement",
}: {
  data: StatementData;
  company: CompanyProfile | null;
  /** true면 공급받는자 보관용 1매만(매출 입력 미리보기). 기본은 2매(받는자+공급자). */
  recipientOnly?: boolean;
  /** "quote"면 견적서 양식(타이틀·하단 문구·1매). 기본 "statement"(거래명세표). */
  mode?: "statement" | "quote";
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

  // 견적서는 1매만(절취선·공급자 카피 없음)
  const single = recipientOnly || mode === "quote";

  return (
    <div className="statement-print flex flex-col gap-6 print:gap-3">
      {/* 거래명세표는 자료/무자료 무관하게 형식적으로 동일 발행. 무자료 식별은 페이지 상단 메타에서 표시. */}
      <StatementCopy data={data} company={company} variant="recipient" mode={mode} />
      {single ? null : (
        <>
          <div className="relative h-0 border-t-2 border-dashed border-zinc-400 print:border-zinc-600">
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-[10px] text-muted-foreground print:bg-white">
              ✂ 절취선 (보관용 분리)
            </span>
          </div>
          <StatementCopy data={data} company={company} variant="supplier" mode={mode} />
        </>
      )}
    </div>
  );
}

function StatementCopy({
  data,
  company,
  variant,
  mode = "statement",
}: {
  data: StatementData;
  company: CompanyProfile;
  variant: "recipient" | "supplier";
  mode?: "statement" | "quote";
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
  // 철근(규격 있는 라인)은 품목칸에 '철근'을 첫 행만 표기하고 이후는 비움(중복 제거).
  const firstRebarIdx = data.lines.findIndex((l) => !!l.spec);
  // 입금계좌 '농협 [번호] 최원식' — bank_default_name 이 '은행/예금주' 포맷이면 분리해 번호를 사이에.
  const bankParts = (company.bank_default_name ?? "").split("/").map((x) => x.trim());
  const bankLine = [bankParts[0], company.bank_default_no, bankParts[1] || company.representative]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={`statement-copy border-2 ${baseClass} p-3 text-xs print:p-2 print:text-[10pt]`}
    >
      {/* 제목 */}
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-zinc-500">{data.doc_no}</div>
        <h2 className={`text-center text-lg font-bold tracking-wider ${titleClass}`}>
          {mode === "quote" ? "견 적 서" : "거래명세표"}
          {mode === "quote" ? null : (
            <span className="ml-2 text-sm font-normal">
              ({isRec ? "공급받는자 보관용" : "공급자 보관용"})
            </span>
          )}
        </h2>
        <div className="text-xs text-zinc-500">
          {dateMonth}월 {dateDay}일
        </div>
      </div>

      {/* 양측 사업자 정보 */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {/* 공급받는자 */}
        <table className={`w-full border table-fixed ${baseClass}`}>
          <colgroup>
            <col style={{ width: "20%" }} />
            <col />
            <col style={{ width: "20%" }} />
            <col />
          </colgroup>
          <tbody>
            <PartyRow label="등록번호" value={formatBusinessNo(data.partner.business_no)} variant={variant} />
            <PartyDoubleRow
              label1="상호"
              value1={data.partner.name}
              label2="대표자"
              value2={data.partner.representative}
              variant={variant}
            />
            <PartyRow label="현장주소" value={data.site_name ?? ""} variant={variant} />
            <PartyDoubleRow
              label1="전화"
              value1={formatPhone(data.partner.phone)}
              label2="팩스"
              value2={formatPhone(data.partner.fax)}
              variant={variant}
            />
          </tbody>
        </table>

        {/* 공급자 (우리) */}
        <table className={`w-full border table-fixed ${baseClass}`}>
          <colgroup>
            <col style={{ width: "20%" }} />
            <col />
            <col style={{ width: "20%" }} />
            <col />
          </colgroup>
          <tbody>
            <PartyRow label="등록번호" value={formatBusinessNo(company.business_no)} variant={variant} />
            <PartyDoubleRow
              label1="상호"
              value1={company.name}
              label2="대표자"
              value2={
                company.representative ? (
                  <span className="inline-flex items-center gap-1">
                    {company.representative}
                    {company.stamp_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={company.stamp_url}
                        alt="인"
                        className="inline-block h-9 w-9 object-contain"
                      />
                    ) : (
                      <span className="text-[10px]">(인)</span>
                    )}
                  </span>
                ) : null
              }
              variant={variant}
            />
            <PartyRow label="사업장주소" value={company.address} variant={variant} />
            <PartyDoubleRow
              label1="전화"
              value1={formatPhone(company.phone)}
              label2="팩스"
              value2={formatPhone(company.fax)}
              variant={variant}
            />
          </tbody>
        </table>
      </div>

      {/* 금액 (한글 좌·숫자 우) */}
      <div className={`mt-2 flex items-center justify-between gap-3 ${headClass} px-3 py-2 ${baseClass} border`}>
        <span className="text-left text-base font-medium">
          <span className="font-semibold">금 액 :</span> {toKoreanAmount(data.total_krw)}원 정
        </span>
        <span className={`whitespace-nowrap text-right text-xl font-bold tabular-nums ${titleClass}`}>
          {fmtKrwSym(data.total_krw)}
        </span>
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
                  {i === 0
                    ? (() => {
                        const d = line.ordered_on ? new Date(line.ordered_on) : null;
                        return d ? `${d.getMonth() + 1}/${d.getDate()}` : `${dateMonth}/${dateDay}`;
                      })()
                    : ""}
                </td>
                <td className={`border ${baseClass} px-1 py-0.5`}>
                  {line.spec ? (i === firstRebarIdx ? "철근" : "") : line.item_name}
                </td>
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
                  {fmtKrw(line.vat_krw)}
                </td>
                <td className={`border ${baseClass} px-1 py-0.5 text-center text-[10px]`}></td>
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
              소 계 (공급가액 / 세액)
            </td>
            <td className={`border ${baseClass} px-1 py-1 text-right tabular-nums`}>
              {fmtKrw(data.subtotal_krw)}
            </td>
            <td className={`border ${baseClass} px-1 py-1 text-right tabular-nums`}>
              {fmtKrw(data.vat_krw)}
            </td>
            <td className={`border ${baseClass}`}></td>
          </tr>
        </tfoot>
      </table>

      {/* 하단: 명세표=입금계좌+인수자 / 견적서='위와 같이 견적합니다.' */}
      {mode === "quote" ? (
        <div className={`mt-2 border ${baseClass} px-3 py-2 text-center text-sm font-medium`}>
          위와 같이 견적합니다.
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <div className={`col-span-2 border ${baseClass} px-2 py-1`}>
            <span className="text-muted-foreground">입금계좌: </span>
            {bankLine}
          </div>
          <div className={`border ${baseClass} px-2 py-1 text-center`}>
            인 수 자: ______________ (인)
          </div>
        </div>
      )}
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
        className={`border ${baseClass} ${headClass} px-1 py-0.5 text-center text-[10px] font-medium w-20`}
      >
        {label}
      </th>
      <td
        colSpan={3}
        className={`border ${baseClass} px-1 pl-3 py-0.5 text-xs ${bold ? "font-semibold" : ""}`}
      >
        {value || " "}
      </td>
    </tr>
  );
}

function PartyDoubleRow({
  label1,
  value1,
  label2,
  value2,
  variant,
}: {
  label1: string;
  value1: string | null | React.ReactNode;
  label2: string;
  value2: string | null | React.ReactNode;
  variant: "recipient" | "supplier";
}) {
  const isRec = variant === "recipient";
  const headClass = isRec
    ? "bg-blue-50 text-blue-900 dark:bg-blue-950/20"
    : "bg-red-50 text-red-900 dark:bg-red-950/20";
  const baseClass = isRec ? "border-blue-700" : "border-red-700";
  const thClass = `border ${baseClass} ${headClass} px-1 py-0.5 text-center text-[10px] font-medium`;
  const tdClass = `border ${baseClass} px-1 pl-3 py-0.5 text-xs`;
  return (
    <tr>
      <th className={`${thClass} w-20`}>{label1}</th>
      <td className={tdClass}>{value1 || " "}</td>
      <th className={`${thClass} w-16`}>{label2}</th>
      <td className={tdClass}>{value2 || " "}</td>
    </tr>
  );
}
