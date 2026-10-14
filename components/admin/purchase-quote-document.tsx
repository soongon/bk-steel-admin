import { type CompanyProfile } from "@/lib/company-profile";
import { formatBusinessNo, formatPhone } from "@/lib/format";
import { PURCHASE_QUOTE_DEFAULT_TERMS, perKgToPerTon } from "@/lib/purchase-quote";

/** 매입견적서 출력 데이터 — 총액 없음. 라인은 품목 + 원/kg(톤당은 환산 표시). */
export type PurchaseQuoteDocumentData = {
  doc_no: string;
  quote_date: string; // YYYY-MM-DD
  valid_until: string | null;
  partner: {
    name: string; // 판매자(우리에게 파는 쪽) — 거래처명 또는 미등록 판매자명
    representative: string | null;
    phone: string | null;
    address: string | null;
  };
  site_name: string | null;
  is_documented: boolean; // TRUE: 단가는 부가세 별도(공급가액) / FALSE: 무자료
  lines: Array<{
    name: string;
    spec: string | null;
    price_per_kg: number;
    note: string | null;
  }>;
  weighing_terms: string | null;
  delivery_terms: string | null;
  payment_terms: string | null;
  notes: string | null;
};

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const MIN_ROWS = 4;

/**
 * 매입견적서 — A4 세로 1매. 매출 견적서(QuoteDocument)와 같은 격식이되 "단가표" 성격:
 *   합계금액·한글금액·세액 컬럼 없음. 라인은 kg당 단가 + 톤당 환산. 총중량·금액은 "당일 계근 후 확정" 문구로 처리.
 *   수신처는 판매자(우리에게 파는 쪽), 우측 표는 매입자(우리).
 */
export function PurchaseQuoteDocument({
  data,
  company,
}: {
  data: PurchaseQuoteDocumentData;
  company: CompanyProfile | null;
}) {
  if (!company) {
    return (
      <div className="rounded-md border-2 border-amber-500/60 bg-amber-50 p-6 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <h2 className="font-semibold">회사 정보 미설정</h2>
        <p className="mt-2 text-sm">
          이 책의 회사 정보가 등록되지 않았습니다. <strong>설정 → 회사 정보</strong>에서 먼저 등록해주세요.
        </p>
      </div>
    );
  }

  const filled = [...data.lines, ...Array.from({ length: Math.max(0, MIN_ROWS - data.lines.length) }, () => null)];
  const single = data.lines.length === 1 ? data.lines[0] : null;
  const prices = data.lines.map((l) => l.price_per_kg);
  const lo = prices.length ? Math.min(...prices) : 0;
  const hi = prices.length ? Math.max(...prices) : 0;

  return (
    <div className="purchase-quote-print text-zinc-900 print:text-black">
      <h1 className="text-center text-2xl font-bold tracking-[0.4em] text-zinc-800">매 입 견 적 서</h1>
      <div className="mx-auto mt-1 h-0.5 w-48 bg-zinc-800" />

      {/* 메타 */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2 text-xs">
        <div className="space-y-0.5">
          <div>
            <span className="text-zinc-500">견적번호 </span>
            <span className="font-mono font-medium">{data.doc_no}</span>
          </div>
          <div>
            <span className="text-zinc-500">견적일 </span>
            <span className="font-medium">{data.quote_date}</span>
            {data.valid_until ? (
              <>
                <span className="ml-2 text-zinc-500">유효기간 </span>
                <span className="font-medium">{data.valid_until}</span>
              </>
            ) : null}
          </div>
        </div>
        <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {data.is_documented ? "단가는 부가세 별도" : "무자료(부가세 없음)"}
        </span>
      </div>

      {/* 판매자(좌) + 매입자(우) */}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div className="border border-zinc-400 p-2 text-xs">
          <div className="mb-1 text-[10px] font-medium text-zinc-500">판매자 (받는 분)</div>
          <div className="text-sm font-semibold">{data.partner.name || "판매자"} 귀하</div>
          {data.site_name ? <div className="mt-1 text-zinc-600">현장: {data.site_name}</div> : null}
          {data.partner.representative ? <div className="text-zinc-600">담당: {data.partner.representative}</div> : null}
          {data.partner.phone ? <div className="text-zinc-600">연락처: {formatPhone(data.partner.phone)}</div> : null}
          {data.partner.address ? <div className="text-zinc-600">주소: {data.partner.address}</div> : null}
        </div>
        <table className="w-full border border-zinc-400 text-xs">
          <colgroup>
            <col style={{ width: "26%" }} />
            <col />
          </colgroup>
          <tbody>
            <Row label="매입자" value={<span className="font-semibold">{company.name}</span>} />
            <Row label="등록번호" value={formatBusinessNo(company.business_no)} />
            <Row
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
            <Row label="주소" value={company.address} />
            <Row label="전화" value={formatPhone(company.mobile || company.phone)} />
          </tbody>
        </table>
      </div>

      {/* 핵심 단가 — 품목 1개면 크게 */}
      <div className="mt-2 flex items-center justify-between gap-3 border border-zinc-400 bg-zinc-50 px-3 py-2">
        <span className="text-sm">
          <span className="font-semibold">매입 단가 :</span>{" "}
          {single ? (
            <>
              {single.name}
              {single.spec ? <span className="text-zinc-600"> ({single.spec})</span> : null}
            </>
          ) : (
            <span className="text-zinc-600">아래 품목별 단가 참조</span>
          )}
        </span>
        {single ? (
          <span className="whitespace-nowrap text-right tabular-nums">
            <span className="text-xl font-bold">₩{fmt(single.price_per_kg)}</span>
            <span className="text-sm font-semibold"> /kg</span>
            <span className="ml-2 text-sm text-zinc-600">(₩{fmt(perKgToPerTon(single.price_per_kg))} /톤)</span>
          </span>
        ) : prices.length > 0 ? (
          <span className="whitespace-nowrap text-right tabular-nums">
            <span className="text-lg font-bold">
              ₩{fmt(lo)}
              {lo !== hi ? ` ~ ₩${fmt(hi)}` : ""}
            </span>
            <span className="text-sm font-semibold"> /kg</span>
          </span>
        ) : null}
      </div>

      {/* 라인 표 */}
      <table className="mt-2 w-full table-fixed border-collapse border border-zinc-400 text-xs">
        <thead className="bg-zinc-100">
          <tr>
            <th className="w-7 border border-zinc-400 px-1 py-1">No</th>
            <th className="w-32 border border-zinc-400 px-1 py-1">품 목</th>
            <th className="border border-zinc-400 px-1 py-1">규격 · 상태</th>
            <th className="w-24 border border-zinc-400 px-1 py-1">단가 (원/kg)</th>
            <th className="w-28 border border-zinc-400 px-1 py-1">환산 (원/톤)</th>
            <th className="w-28 border border-zinc-400 px-1 py-1">비 고</th>
          </tr>
        </thead>
        <tbody>
          {filled.map((l, i) =>
            l ? (
              <tr key={i}>
                <td className="border border-zinc-400 px-1 py-0.5 text-center">{i + 1}</td>
                <td className="border border-zinc-400 px-1 py-0.5 font-medium">{l.name}</td>
                <td className="border border-zinc-400 px-1 py-0.5 text-[11px]">{l.spec ?? ""}</td>
                <td className="border border-zinc-400 px-1 py-0.5 text-right font-semibold tabular-nums">{fmt(l.price_per_kg)}</td>
                <td className="border border-zinc-400 px-1 py-0.5 text-right tabular-nums text-zinc-600">{fmt(perKgToPerTon(l.price_per_kg))}</td>
                <td className="border border-zinc-400 px-1 py-0.5 text-[11px]">{l.note ?? ""}</td>
              </tr>
            ) : (
              <tr key={i}>
                {Array.from({ length: 6 }).map((_, c) => (
                  <td key={c} className="h-5 border border-zinc-400 px-1 py-0.5">
                    &nbsp;
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
        <tfoot className="bg-zinc-50">
          <tr>
            <td colSpan={6} className="border border-zinc-400 px-2 py-1 text-[11px] text-zinc-700">
              ※ 총중량·매입금액은 <strong>당일 계근 결과</strong>에 따라 확정됩니다 (매입금액 = 계근 중량 × 단가
              {data.is_documented ? ", 부가세 별도" : ""}).
            </td>
          </tr>
        </tfoot>
      </table>

      {/* 조건 */}
      <div className="mt-2 border border-zinc-400 text-xs">
        <ConditionRow label="계근" value={data.weighing_terms || PURCHASE_QUOTE_DEFAULT_TERMS.weighing} />
        <ConditionRow label="운반·상하차" value={data.delivery_terms || PURCHASE_QUOTE_DEFAULT_TERMS.delivery} />
        <ConditionRow label="결제" value={data.payment_terms || PURCHASE_QUOTE_DEFAULT_TERMS.payment} />
        <ConditionRow
          label="부가세"
          value={
            data.is_documented
              ? "단가는 공급가액 기준이며 부가세 별도 (사업자 판매자는 세금계산서 발행)"
              : "무자료 거래 — 부가세 없음"
          }
        />
        <ConditionRow
          label="시세변동"
          value={`본 단가는 고철·철근 시세 변동에 따라 변경될 수 있으며, ${data.valid_until ? "유효기간 내" : "견적일 기준"} 계근·인수 시 적용됩니다.`}
          last
        />
      </div>

      {data.notes ? (
        <div className="mt-2 border border-zinc-400 px-2 py-1 text-xs">
          <span className="text-zinc-500">비고: </span>
          {data.notes}
        </div>
      ) : null}

      <div className="mt-4 text-center text-sm">
        <p className="font-medium">위와 같이 매입 단가를 견적합니다.</p>
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
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
