import { type CompanyProfile } from "@/lib/company-profile";
import { formatBusinessNo, formatPhone } from "@/lib/format";
import { type StatementData, toKoreanAmount } from "@/components/admin/trading-statement";

/** 견적서 출력 데이터 — 거래명세표(StatementData)에 견적 전용 필드를 더한 형태. */
export type QuoteDocumentData = StatementData & {
  valid_until: string | null;
  delivery_terms: string | null;
  payment_terms: string | null;
};

const fmtKrw = (n: number) => Math.round(n).toLocaleString("ko-KR");
const fmtKrwSym = (n: number) => `₩${fmtKrw(n)}`;
const MIN_ROWS = 6; // 표 높이 유지용 빈 행

/**
 * 견적서 전용 출력 양식 — A4 세로 1매(거래명세표와 달리 절취선·2매 없음).
 * 격식: 견적번호·견적일·유효기간 / 수신처·공급자(직인) / 한글 금액 / 라인 / 납품·결제·운반·시세변동 조건.
 */
export function QuoteDocument({
  data,
  company,
}: {
  data: QuoteDocumentData;
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

  const filledLines = [
    ...data.lines,
    ...Array.from({ length: Math.max(0, MIN_ROWS - data.lines.length) }, () => null),
  ];
  const firstRebarIdx = data.lines.findIndex((l) => !!l.spec);

  return (
    <div className="quote-print text-zinc-900 print:text-black">
      {/* 제목 */}
      <h1 className="text-center text-2xl font-bold tracking-[0.4em] text-zinc-800">견 적 서</h1>
      <div className="mx-auto mt-1 h-0.5 w-40 bg-zinc-800" />

      {/* 견적 메타 */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2 text-xs">
        <div className="space-y-0.5">
          <div>
            <span className="text-zinc-500">견적번호 </span>
            <span className="font-mono font-medium">{data.doc_no}</span>
          </div>
          <div>
            <span className="text-zinc-500">견적일 </span>
            <span className="font-medium">{data.ordered_on}</span>
            {data.valid_until ? (
              <>
                <span className="ml-2 text-zinc-500">유효기간 </span>
                <span className="font-medium">{data.valid_until}</span>
              </>
            ) : null}
          </div>
        </div>
        {!data.is_documented ? (
          <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500">무자료(부가세 별도 없음)</span>
        ) : null}
      </div>

      {/* 수신처(좌) + 공급자(우) */}
      <div className="mt-2 grid grid-cols-2 gap-3">
        {/* 수신처 */}
        <div className="border border-zinc-400 p-2 text-xs">
          <div className="mb-1 text-[10px] font-medium text-zinc-500">받는 분</div>
          <div className="text-sm font-semibold">{data.partner.name || "—"} 귀하</div>
          {data.site_name ? <div className="mt-1 text-zinc-600">현장: {data.site_name}</div> : null}
          {data.partner.representative ? (
            <div className="text-zinc-600">담당: {data.partner.representative}</div>
          ) : null}
          {data.partner.phone ? (
            <div className="text-zinc-600">연락처: {formatPhone(data.partner.phone)}</div>
          ) : null}
        </div>

        {/* 공급자 */}
        <table className="w-full border border-zinc-400 text-xs">
          <colgroup>
            <col style={{ width: "26%" }} />
            <col />
          </colgroup>
          <tbody>
            <SupplyRow label="공급자" value={<span className="font-semibold">{company.name}</span>} />
            <SupplyRow label="등록번호" value={formatBusinessNo(company.business_no)} />
            <SupplyRow
              label="대표자"
              value={
                <span className="relative inline-flex items-center gap-1 pr-1">
                  {company.representative}
                  {company.stamp_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={company.stamp_url} alt="인" className="pointer-events-none absolute left-full top-1/2 ml-1 size-9 -translate-y-1/2 object-contain" />
                  ) : (
                    <span className="text-[10px] text-zinc-400">(인)</span>
                  )}
                </span>
              }
            />
            <SupplyRow label="주소" value={company.address} />
            <SupplyRow label="전화" value={formatPhone(company.phone)} />
          </tbody>
        </table>
      </div>

      {/* 합계 금액 (한글 + 숫자) */}
      <div className="mt-2 flex items-center justify-between gap-3 border border-zinc-400 bg-zinc-50 px-3 py-2">
        <span className="text-sm">
          <span className="font-semibold">합계금액 :</span> 일금 {toKoreanAmount(data.total_krw)}원정
        </span>
        <span className="whitespace-nowrap text-xl font-bold tabular-nums">{fmtKrwSym(data.total_krw)}</span>
      </div>

      {/* 라인 표 */}
      <table className="mt-2 w-full border-collapse border border-zinc-400 text-xs">
        <thead className="bg-zinc-100">
          <tr>
            <th className="border border-zinc-400 px-1 py-1 w-8">No</th>
            <th className="border border-zinc-400 px-1 py-1">품 목</th>
            <th className="border border-zinc-400 px-1 py-1 w-28">규 격</th>
            <th className="border border-zinc-400 px-1 py-1 w-20">수 량</th>
            <th className="border border-zinc-400 px-1 py-1 w-20">단 가</th>
            <th className="border border-zinc-400 px-1 py-1 w-24">공급가액</th>
            {data.is_documented ? <th className="border border-zinc-400 px-1 py-1 w-20">세 액</th> : null}
          </tr>
        </thead>
        <tbody>
          {filledLines.map((line, i) =>
            line ? (
              <tr key={i}>
                <td className="border border-zinc-400 px-1 py-0.5 text-center">{i + 1}</td>
                <td className="border border-zinc-400 px-1 py-0.5">
                  {line.spec ? (i === firstRebarIdx ? "철근" : "") : line.item_name}
                </td>
                <td className="border border-zinc-400 px-1 py-0.5 text-center text-[11px]">{line.spec}</td>
                <td className="border border-zinc-400 px-1 py-0.5 text-right tabular-nums">
                  {line.qty} {line.unit}
                  {line.weight_kg != null ? (
                    <span className="ml-1 text-[10px] text-zinc-500">({fmtKrw(line.weight_kg)}kg)</span>
                  ) : null}
                </td>
                <td className="border border-zinc-400 px-1 py-0.5 text-right tabular-nums">
                  {fmtKrw(line.unit_price_krw)}
                </td>
                <td className="border border-zinc-400 px-1 py-0.5 text-right tabular-nums">
                  {fmtKrw(line.subtotal_krw)}
                </td>
                {data.is_documented ? (
                  <td className="border border-zinc-400 px-1 py-0.5 text-right tabular-nums">
                    {fmtKrw(line.vat_krw)}
                  </td>
                ) : null}
              </tr>
            ) : (
              <tr key={i}>
                {Array.from({ length: data.is_documented ? 7 : 6 }).map((_, c) => (
                  <td key={c} className="border border-zinc-400 px-1 py-0.5 h-5">
                    &nbsp;
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
        <tfoot className="bg-zinc-100 font-semibold">
          <tr>
            <td colSpan={data.is_documented ? 5 : 5} className="border border-zinc-400 px-2 py-1 text-right">
              {data.is_documented ? "공급가액 / 세액" : "공급가액"}
            </td>
            <td className="border border-zinc-400 px-1 py-1 text-right tabular-nums">{fmtKrw(data.subtotal_krw)}</td>
            {data.is_documented ? (
              <td className="border border-zinc-400 px-1 py-1 text-right tabular-nums">{fmtKrw(data.vat_krw)}</td>
            ) : null}
          </tr>
          <tr>
            <td colSpan={data.is_documented ? 6 : 5} className="border border-zinc-400 bg-zinc-50 px-2 py-1 text-right">
              합 계
            </td>
            <td className="border border-zinc-400 bg-zinc-50 px-1 py-1 text-right text-sm tabular-nums">
              {fmtKrw(data.total_krw)}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* 견적 조건 */}
      <div className="mt-2 border border-zinc-400 text-xs">
        <ConditionRow label="납품조건" value={data.delivery_terms || "협의"} />
        <ConditionRow label="결제조건" value={data.payment_terms || "협의"} />
        <ConditionRow label="운반·하차" value="현장 하차 기준 (별도 협의 시 변동)" />
        <ConditionRow
          label="시세변동"
          value="본 견적은 철강 시세 변동에 따라 변경될 수 있으며, 유효기간 내 발주 기준입니다."
          last
        />
      </div>

      {data.notes ? (
        <div className="mt-2 border border-zinc-400 px-2 py-1 text-xs">
          <span className="text-zinc-500">비고: </span>
          {data.notes}
        </div>
      ) : null}

      {/* 하단 격식 문구 + 공급자 직인 */}
      <div className="mt-4 text-center text-sm">
        <p className="font-medium">아래와 같이 견적합니다.</p>
        <div className="mt-3 inline-flex items-center gap-2">
          <span className="font-semibold">{company.name}</span>
          {company.stamp_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.stamp_url} alt="인" className="inline-block h-12 w-12 object-contain" />
          ) : (
            <span className="text-xs text-zinc-400">(직인)</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SupplyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr>
      <th className="border border-zinc-400 bg-zinc-100 px-1 py-0.5 text-center text-[10px] font-medium">{label}</th>
      <td className="border border-zinc-400 px-2 py-0.5">{value || " "}</td>
    </tr>
  );
}

function ConditionRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex ${last ? "" : "border-b border-zinc-300"}`}>
      <div className="w-20 shrink-0 bg-zinc-100 px-2 py-1 text-center text-[11px] font-medium text-zinc-600">{label}</div>
      <div className="px-2 py-1">{value}</div>
    </div>
  );
}
