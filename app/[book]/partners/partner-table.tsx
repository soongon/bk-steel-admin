"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FileImageIcon, LayoutGridIcon, ListIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { formatBusinessNo, formatPhone } from "@/lib/format";
import { listMatches, listQuery, nameKeys, nameMatches, phoneMatches } from "@/lib/search";
import { ListSearch, useListSearch } from "@/components/admin/list-search";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PartnerFormDialog, type PartnerRow, type PartnerPrefill } from "./partner-form-dialog";
import { deletePartner } from "./actions";

/**
 * 보기 방식(카드·목록)·정렬(최근 거래·이름·코드) — 브라우저에 기억(localStorage). 서버 렌더는 기본값으로 두고 클라이언트가
 * 붙은 뒤 저장값으로 바꾼다(useSyncExternalStore 라 hydration 불일치 없음). 기본은 카드·최근 거래순(2026-11-04 사용자 요청).
 */
type View = "card" | "list";
type Sort = "recent" | "name" | "code";
const SORT_LABEL: Record<Sort, string> = { recent: "최근 거래", name: "이름", code: "코드" };
const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}
function usePref<T extends string>(key: string, fallback: T, valid: readonly T[]): [T, (v: T) => void] {
  const read = () => {
    try {
      const v = window.localStorage.getItem(key);
      return valid.includes(v as T) ? (v as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const write = (v: T) => {
    try {
      window.localStorage.setItem(key, v);
    } catch {
      /* 사생활 보호 모드 등 — 이번 방문만 */
    }
    listeners.forEach((l) => l());
  };
  return [value, write];
}

/** 가장 최근 거래(매출·매입 중 늦은 것) — 없으면 null. */
function lastTrade(p: PartnerRow): { on: string; kind: "sale" | "purchase" } | null {
  const s = p.last_sale_on ?? null;
  const b = p.last_purchase_on ?? null;
  if (!s && !b) return null;
  if (s && (!b || s >= b)) return { on: s, kind: "sale" };
  return { on: b as string, kind: "purchase" };
}
const sorters: Record<Sort, (a: PartnerRow, b: PartnerRow) => number> = {
  // 최근 거래가 늦은 순, 거래 없는 곳은 맨 뒤 코드순
  recent: (a, b) => {
    const ta = lastTrade(a)?.on ?? "";
    const tb = lastTrade(b)?.on ?? "";
    return tb.localeCompare(ta) || a.code.localeCompare(b.code);
  },
  name: (a, b) => a.name.localeCompare(b.name, "ko") || a.code.localeCompare(b.code),
  code: (a, b) => a.code.localeCompare(b.code),
};

export function PartnerTable({
  partners,
  prefill,
}: {
  partners: PartnerRow[];
  prefill?: PartnerPrefill | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(!!prefill);
  const [editing, setEditing] = useState<PartnerRow | null>(null);
  const [, startTransition] = useTransition();
  const [view, setView] = usePref<View>("partners.view", "card", ["card", "list"]);
  const [sort, setSort] = usePref<Sort>("partners.sort", "recent", ["recent", "name", "code"]);
  const [onlyNoBizNo, setOnlyNoBizNo] = useState(false); // 사업자번호 없는 곳만 — 정리할 때

  // 즉시 검색 — 검색칸 하나로 거래처명(보이는 그대로·회사 표기 무시 둘 다, 한글 조합 중에도 좁혀짐)
  // 또는 전화번호(숫자로만 친 검색어, 번호 묶음 시작부터) 일치. 띄어 쓴 단어는 이름·전화 어디서든 모두 맞으면(이름 + 뒷자리 등).
  const search = useListSearch();
  const indexed = useMemo(() => partners.map((p) => ({ p, keys: nameKeys(p.name) })), [partners]);
  const noBizNoCount = useMemo(() => partners.filter((p) => !p.business_no).length, [partners]);
  const sorted = useMemo(() => [...partners].sort(sorters[sort]), [partners, sort]);
  const { visible, searching } = useMemo(() => {
    const q = listQuery(search.query);
    const base = onlyNoBizNo ? sorted.filter((p) => !p.business_no) : sorted;
    if (q.empty) return { visible: base, searching: onlyNoBizNo };
    const keysOf = new Map(indexed.map(({ p, keys }) => [p.id, keys]));
    return {
      visible: base.filter((p) => {
        const keys = keysOf.get(p.id) ?? nameKeys(p.name);
        return listMatches(q, (k) => nameMatches(keys, k.name) || phoneMatches(p.phone, k.phone));
      }),
      searching: true,
    };
  }, [indexed, sorted, search.query, onlyNoBizNo]);

  useEffect(() => {
    if (prefill?.from_card_id || prefill?.from_radar_id) {
      setEditing(null);
      setOpen(true);
    }
  }, [prefill?.from_card_id, prefill?.from_radar_id]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && prefill) {
      router.replace(pathname);
    }
  }

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(p: PartnerRow) {
    setEditing(p);
    setOpen(true);
  }
  function handleDelete(p: PartnerRow) {
    if (!window.confirm(`거래처 [${p.name}]를 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const result = await deletePartner(p.id);
      if (result.ok) {
        toast.success("삭제되었습니다");
        if (result.warning) toast.warning(result.warning);
      } else toast.error(result.error);
    });
  }

  const empty =
    partners.length === 0 ? (
      <>
        등록된 거래처가 없습니다. <button onClick={openCreate} className="underline">신규 추가</button>
      </>
    ) : visible.length === 0 ? (
      <>
        {onlyNoBizNo && !search.query.trim() ? "사업자번호가 없는 거래처가 없습니다." : <>‘{search.query.trim()}’에 맞는 거래처가 없습니다.</>}{" "}
        <button
          onClick={() => {
            search.clear();
            setOnlyNoBizNo(false);
          }}
          className="underline"
        >
          검색 지우기
        </button>
      </>
    ) : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <ListSearch
          search={search}
          placeholder="거래처명 또는 전화번호 검색"
          label="거래처 검색"
          searching={searching}
          shown={visible.length}
          total={partners.length}
        />
        {/* 사업자번호 없는 곳만 — 세금계산서 발행 전에 채워야 할 거래처 */}
        {noBizNoCount > 0 ? (
          <button
            type="button"
            aria-pressed={onlyNoBizNo}
            onClick={() => setOnlyNoBizNo((v) => !v)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors",
              onlyNoBizNo ? "border-amber-600 bg-amber-600 text-white" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
            )}
            title="사업자번호가 없는 거래처만 보기"
          >
            번호 없음 <span className="tabular-nums">{noBizNoCount}</span>
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="정렬">
            {(Object.keys(SORT_LABEL) as Sort[]).map((k) => {
              const on = k === sort;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSort(k)}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full border px-2.5 text-xs transition-colors",
                    on ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted",
                  )}
                >
                  {SORT_LABEL[k]}
                </button>
              );
            })}
          </div>
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="보기 방식">
            <Button size="icon-xs" variant={view === "card" ? "secondary" : "ghost"} onClick={() => setView("card")} aria-pressed={view === "card"} aria-label="카드로 보기" title="카드">
              <LayoutGridIcon />
            </Button>
            <Button size="icon-xs" variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")} aria-pressed={view === "list"} aria-label="목록으로 보기" title="목록">
              <ListIcon />
            </Button>
          </div>
          <Button onClick={openCreate} size="sm">
            <PlusIcon className="size-4" />
            신규 거래처
          </Button>
        </div>
      </div>

      {view === "card" ? (
        empty ? (
          <div className="rounded-lg border bg-card py-12 text-center text-muted-foreground">{empty}</div>
        ) : (
          // 카드 — 이름·대표자·전화·사업자번호만. 글자는 조금 크게(잘 안 보인다는 2026-11-04 피드백), 넓은 화면에서 한 줄 5장 안팎.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
            {visible.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => openEdit(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openEdit(p);
                  }
                }}
                className={cn(
                  "group relative flex cursor-pointer flex-col gap-1 rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !p.is_active && "opacity-60",
                )}
              >
                <div className="flex items-start gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-base font-semibold" title={p.name}>
                    {p.name}
                  </span>
                  {p.doc_count ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" title={`사업자 이미지 ${p.doc_count}장`}>
                      <FileImageIcon className="size-3.5" />
                      {p.doc_count > 1 ? p.doc_count : null}
                    </span>
                  ) : null}
                  {!p.is_active ? <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 text-[10px] text-zinc-600 dark:bg-zinc-800/50">비활성</span> : null}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.code}</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span className="truncate">{p.representative ?? "—"}</span>
                  <span aria-hidden>·</span>
                  {p.phone ? (
                    <a href={`tel:${p.phone}`} onClick={(e) => e.stopPropagation()} className="shrink-0 tabular-nums hover:underline" title="전화 걸기">
                      {formatPhone(p.phone)}
                    </a>
                  ) : (
                    <span className="shrink-0">—</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <BizNoLine businessNo={p.business_no} size="md" />
                  <LastTradeTag p={p} />
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p);
                  }}
                  aria-label="삭제"
                  title="삭제"
                  className="absolute right-2 bottom-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-destructive focus:opacity-100"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">코드</TableHead>
                <TableHead>거래처명</TableHead>
                <TableHead className="w-32">사업자번호</TableHead>
                <TableHead className="w-28">최근 거래</TableHead>
                <TableHead className="w-24">대표자</TableHead>
                <TableHead className="w-36">연락처</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead className="w-40">업태 · 종목</TableHead>
                <TableHead className="w-16 text-center">활성</TableHead>
                <TableHead className="w-20 text-right">액션</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {empty ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                    {empty}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.code}</TableCell>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {p.name}
                        {p.doc_count ? (
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            title={`사업자 이미지 ${p.doc_count}장 — 눌러서 보기`}
                            aria-label={`사업자 이미지 ${p.doc_count}장 보기`}
                            className="inline-flex items-center gap-0.5 rounded px-1 text-xs font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <FileImageIcon className="size-3.5" />
                            {p.doc_count > 1 ? p.doc_count : null}
                          </button>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <BizNoLine businessNo={p.business_no} />
                    </TableCell>
                    <TableCell>
                      <LastTradeTag p={p} />
                    </TableCell>
                    <TableCell>{p.representative ?? "—"}</TableCell>
                    <TableCell>{p.phone ? formatPhone(p.phone) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {p.email ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-48">
                      {p.business_type || p.business_item ? (
                        <div title={[p.business_type, p.business_item].filter(Boolean).join(" / ")}>
                          <span className="block truncate">{p.business_type ?? "—"}</span>
                          {p.business_item ? (
                            <span className="block truncate text-xs text-muted-foreground">{p.business_item}</span>
                          ) : null}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {p.is_active ? (
                        <span className="inline-flex h-5 items-center rounded-full bg-emerald-100 px-2 text-xs text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          활성
                        </span>
                      ) : (
                        <span className="inline-flex h-5 items-center rounded-full bg-zinc-100 px-2 text-xs text-zinc-600 dark:bg-zinc-800/50">
                          비활성
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon-xs" variant="ghost" onClick={() => openEdit(p)} aria-label="수정">
                          <PencilIcon />
                        </Button>
                        <Button size="icon-xs" variant="ghost" onClick={() => handleDelete(p)} aria-label="삭제">
                          <Trash2Icon className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <PartnerFormDialog
        open={open}
        onOpenChange={handleOpenChange}
        editing={editing}
        prefill={editing ? null : prefill}
      />
    </>
  );
}

/** 사업자번호 — 있으면 번호, 없으면 주황 '번호 없음'(세금계산서 발행 전 채워야 할 곳이 한눈에). size md = 카드용(조금 크게). */
function BizNoLine({ businessNo, size = "sm" }: { businessNo: string | null; size?: "sm" | "md" }) {
  const md = size === "md";
  return businessNo ? (
    <span className={cn("font-mono text-muted-foreground tabular-nums", md ? "text-sm" : "text-xs")}>{formatBusinessNo(businessNo)}</span>
  ) : (
    <span className={cn("inline-flex w-fit items-center rounded bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", md ? "px-2 py-0.5 text-xs" : "px-1.5 text-[11px]")}>
      사업자번호 없음
    </span>
  );
}

/** 최근 거래 — '매출 11-04' / '매입 10-22'(연도는 올해가 아니면 붙임). 거래 없으면 흐리게 '거래 없음'. */
function LastTradeTag({ p }: { p: PartnerRow }) {
  const t = lastTrade(p);
  if (!t) return <span className="text-xs text-muted-foreground/60">거래 없음</span>;
  const thisYear = t.on.slice(0, 4) === String(new Date().getFullYear());
  const date = thisYear ? t.on.slice(5, 10) : t.on.slice(2, 10);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 text-xs tabular-nums",
        t.kind === "sale" ? "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" : "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
      )}
      title={`최근 ${t.kind === "sale" ? "매출" : "매입"} 주문일 ${t.on}`}
    >
      {t.kind === "sale" ? "매출" : "매입"} {date}
    </span>
  );
}
