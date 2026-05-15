"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { type Book, type BookView } from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";

export type ItemInfo = {
  id: string;
  code: string;
  name: string;
  category: string;
  rebar_spec_code: string | null;
  rebar_grade_code: string | null;
  length_m: number | null;
};

export type SummaryRow = {
  book: Book;
  item_id: string;
  total_qty: number;
  total_weight_kg: number | null;
  line_count: number;
  market_price_per_kg: number | null;
  valuation_krw: number | null;
  item: ItemInfo | null;
};

export type LotRow = {
  purchase_line_id: string;
  book: Book;
  item_id: string;
  warehouse_id: string;
  acquired_unit: string;
  acquired_qty: number;
  remaining_qty: number;
  theoretical_weight_kg: number | null;
  actual_weight_kg: number | null;
  remaining_weight_kg: number | null;
  unit_price_krw: number;
  grade: string | null;
  length_mm: number | null;
  bars_count: number | null;
  status: string;
  acquired_at: string;
};

const fmtNum = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : n.toLocaleString("ko-KR", { maximumFractionDigits: d });
const fmtKrw = (n: number | null | undefined) =>
  n == null ? "—" : `₩${Math.round(n).toLocaleString("ko-KR")}`;
const fmtKg = (n: number | null | undefined) =>
  n == null ? "—" : `${fmtNum(n, 0)} kg`;

type SortKey = "name" | "weight" | "valuation" | "lots";

export function InventoryTable({
  summary,
  lotsByItem,
  view,
}: {
  summary: SummaryRow[];
  lotsByItem: Record<string, LotRow[]>; // key: `${book}::${item_id}`
  view: BookView;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("weight");
  const [sortDesc, setSortDesc] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summary
      .filter((r) => {
        if (!q) return true;
        const item = r.item;
        if (!item) return false;
        return (
          item.name.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const dir = sortDesc ? -1 : 1;
        switch (sortKey) {
          case "name":
            return ((a.item?.name ?? "").localeCompare(b.item?.name ?? "")) * dir;
          case "weight":
            return ((a.total_weight_kg ?? 0) - (b.total_weight_kg ?? 0)) * dir;
          case "valuation":
            return ((a.valuation_krw ?? 0) - (b.valuation_krw ?? 0)) * dir;
          case "lots":
            return (a.line_count - b.line_count) * dir;
        }
      });
  }, [summary, search, sortKey, sortDesc]);

  const totalWeight = filtered.reduce((s, r) => s + (r.total_weight_kg ?? 0), 0);
  const totalValuation = filtered.reduce((s, r) => s + (r.valuation_krw ?? 0), 0);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDesc(!sortDesc);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  }
  function toggleExpand(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder="품목명·코드 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            총 <span className="font-medium text-foreground">{filtered.length}</span> 품목
          </span>
          <span>·</span>
          <span>
            잔량 <span className="font-medium text-foreground">{fmtKg(totalWeight)}</span>
          </span>
          <span>·</span>
          <span>
            평가 <span className="font-medium text-foreground">{fmtKrw(totalValuation)}</span>
          </span>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="w-8"></th>
              <SortHeader k="name" label="품목" current={sortKey} desc={sortDesc} onSort={toggleSort} />
              {view === "all" ? <th className="w-16 px-2 py-2 text-left">책</th> : null}
              <th className="w-24 px-2 py-2 text-left text-xs">규격</th>
              <SortHeader k="weight" label="잔량(kg)" current={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
              <SortHeader k="lots" label="lot 수" current={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
              <th className="px-2 py-2 text-right">시가/kg</th>
              <SortHeader k="valuation" label="평가액" current={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={view === "all" ? 8 : 7} className="py-12 text-center text-muted-foreground">
                  잔량 있는 품목이 없습니다
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const key = `${r.book}::${r.item_id}`;
                const expanded = expandedKey === key;
                const lots = lotsByItem[key] ?? [];
                const item = r.item;
                const spec = item?.category === "rebar" && item.rebar_spec_code
                  ? [item.rebar_spec_code, item.rebar_grade_code, item.length_m ? `${item.length_m}M` : null]
                      .filter(Boolean)
                      .join(" ")
                  : "";
                return (
                  <FragmentRow
                    key={key}
                    rowKey={key}
                    expanded={expanded}
                    onToggle={() => toggleExpand(key)}
                    summary={r}
                    item={item}
                    spec={spec}
                    lots={lots}
                    view={view}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FragmentRow({
  rowKey,
  expanded,
  onToggle,
  summary,
  item,
  spec,
  lots,
  view,
}: {
  rowKey: string;
  expanded: boolean;
  onToggle: () => void;
  summary: SummaryRow;
  item: ItemInfo | null;
  spec: string;
  lots: LotRow[];
  view: BookView;
}) {
  const colSpan = view === "all" ? 8 : 7;
  return (
    <>
      <tr
        className={cn(
          "cursor-pointer border-t transition-colors hover:bg-muted/30",
          expanded && "bg-muted/30",
        )}
        onClick={onToggle}
      >
        <td className="w-8 px-2 py-2">
          {expanded ? (
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3.5 text-muted-foreground" />
          )}
        </td>
        <td className="px-2 py-2">
          <div className="font-medium">{item?.name ?? "—"}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{item?.code ?? ""}</div>
        </td>
        {view === "all" ? (
          <td className="px-2 py-2">
            <BookBadge book={summary.book} size="sm" />
          </td>
        ) : null}
        <td className="px-2 py-2 text-xs text-muted-foreground">{spec || "—"}</td>
        <td className="px-2 py-2 text-right tabular-nums">{fmtKg(summary.total_weight_kg)}</td>
        <td className="px-2 py-2 text-right tabular-nums text-xs">{summary.line_count}</td>
        <td className="px-2 py-2 text-right text-xs tabular-nums text-muted-foreground">
          {summary.market_price_per_kg != null ? `₩${fmtNum(summary.market_price_per_kg)}` : "—"}
        </td>
        <td className="px-2 py-2 text-right tabular-nums font-medium">
          {fmtKrw(summary.valuation_krw)}
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-muted/10">
          <td colSpan={colSpan} className="px-3 py-2">
            <LotDetail lots={lots} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function LotDetail({ lots }: { lots: LotRow[] }) {
  if (lots.length === 0) {
    return <p className="text-xs text-muted-foreground">lot 상세 없음</p>;
  }
  // FIFO: 매입일 오래된 순으로 표시 (재고 회전 관점)
  const sorted = [...lots].sort((a, b) => a.acquired_at.localeCompare(b.acquired_at));
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th className="px-2 py-1 text-left">매입일</th>
          <th className="px-2 py-1 text-right">매입량</th>
          <th className="px-2 py-1 text-right">잔량</th>
          <th className="px-2 py-1 text-right">매입가</th>
          <th className="px-2 py-1 text-left">등급/길이</th>
          <th className="px-2 py-1 text-left">상태</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((lot) => {
          const acquiredDate = lot.acquired_at.slice(0, 10);
          return (
            <tr key={lot.purchase_line_id} className="border-t">
              <td className="px-2 py-1 font-mono">{acquiredDate}</td>
              <td className="px-2 py-1 text-right tabular-nums">
                {fmtNum(lot.acquired_qty, 2)} {lot.acquired_unit}
                {lot.actual_weight_kg || lot.theoretical_weight_kg ? (
                  <div className="text-[10px] text-muted-foreground">
                    {fmtNum(lot.actual_weight_kg ?? lot.theoretical_weight_kg, 0)}kg
                  </div>
                ) : null}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                <span className="font-medium">{fmtNum(lot.remaining_qty, 2)} {lot.acquired_unit}</span>
                {lot.remaining_weight_kg != null ? (
                  <div className="text-[10px] text-muted-foreground">
                    {fmtNum(lot.remaining_weight_kg, 0)}kg
                  </div>
                ) : null}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {fmtKrw(lot.unit_price_krw)}
              </td>
              <td className="px-2 py-1 text-muted-foreground">
                {[lot.grade, lot.length_mm ? `${lot.length_mm}mm` : null].filter(Boolean).join(" / ") || "—"}
                {lot.bars_count ? ` · ${lot.bars_count}본` : ""}
              </td>
              <td className="px-2 py-1">
                <span
                  className={cn(
                    "inline-flex h-4 items-center rounded px-1.5 text-[10px]",
                    lot.status === "in_stock"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : lot.status === "partial_out"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {STATUS_KO[lot.status] ?? lot.status}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const STATUS_KO: Record<string, string> = {
  ordered: "발주",
  in_stock: "입고완료",
  partial_out: "일부 출고",
  depleted: "전량 출고",
  transferred_out: "이관",
  scrapped: "폐기",
};

function SortHeader({
  k,
  label,
  current,
  desc,
  onSort,
  align = "left",
}: {
  k: SortKey;
  label: string;
  current: SortKey;
  desc: boolean;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = current === k;
  return (
    <th
      className={cn(
        "cursor-pointer select-none px-2 py-2 text-xs",
        align === "right" ? "text-right" : "text-left",
      )}
      onClick={() => onSort(k)}
    >
      <span className={cn("inline-flex items-center gap-1", active && "text-foreground")}>
        {label}
        {active ? <span className="text-[10px]">{desc ? "▼" : "▲"}</span> : null}
      </span>
    </th>
  );
}

