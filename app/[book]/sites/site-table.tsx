"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LayoutGridIcon, ListIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ListSearch, useListSearch } from "@/components/admin/list-search";
import { useListPref } from "@/components/admin/use-list-pref";
import { listMatches, listQuery, nameKeys, nameMatches } from "@/lib/search";
import { cn } from "@/lib/utils";
import { SiteFormDialog, type SiteRow } from "./site-form-dialog";
import { deleteSite } from "./actions";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  active: {
    label: "진행",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  closed: {
    label: "완료",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400",
  },
};

type View = "card" | "list";
type Sort = "recent" | "name" | "code";
const SORT_LABEL: Record<Sort, string> = { recent: "최근 납품", name: "이름", code: "코드" };

/** 'YYYY-MM-DD' → 올해면 'MM-DD', 아니면 'YY-MM-DD' */
const shortDate = (d: string) => (d.slice(0, 4) === String(new Date().getFullYear()) ? d.slice(5, 10) : d.slice(2, 10));

/**
 * 현장 목록 — 카드(기본)·목록 전환, 최근 납품순(기본)·이름·코드 정렬(거래처 목록과 같은 방식, 2026-11-04 사용자 요청).
 * 현장은 주소·시공사가 거의 비어 있어 카드는 이름·코드·납품 기간·상태가 중심.
 */
export function SiteTable({
  sites,
  firstSaleBySite,
  lastSaleBySite,
}: {
  sites: SiteRow[];
  firstSaleBySite: Record<string, string>;
  lastSaleBySite: Record<string, string>;
}) {
  const params = useParams<{ book: string }>();
  const book = params.book ?? "all";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [, startTransition] = useTransition();
  const [view, setView] = useListPref<View>("sites.view", "card", ["card", "list"]);
  const [sort, setSort] = useListPref<Sort>("sites.sort", "recent", ["recent", "name", "code"]);

  // 즉시 검색 — 표에 보이는 글자(현장명·지역·주소·시공사·건축주)로, 한글 조합 중에도 좁혀짐.
  // 띄어 쓴 단어는 칸·순서 상관없이 모두 맞으면('OO면 △△리'를 'OO △△'로). 현장엔 전화번호 칸이 없다.
  const search = useListSearch();
  const sorted = useMemo(() => {
    const by: Record<Sort, (a: SiteRow, b: SiteRow) => number> = {
      // 최근 납품이 늦은 순, 납품 없는 현장은 맨 뒤 코드순
      recent: (a, b) => (lastSaleBySite[b.id] ?? "").localeCompare(lastSaleBySite[a.id] ?? "") || a.code.localeCompare(b.code),
      name: (a, b) => a.name.localeCompare(b.name, "ko") || a.code.localeCompare(b.code),
      code: (a, b) => a.code.localeCompare(b.code),
    };
    return [...sites].sort(by[sort]);
  }, [sites, sort, lastSaleBySite]);
  const indexed = useMemo(
    () => new Map(sites.map((s) => [s.id, [s.name, s.city, s.address, s.client_name, s.owner_name].map(nameKeys)])),
    [sites],
  );
  const { visible, searching } = useMemo(() => {
    const q = listQuery(search.query);
    if (q.empty) return { visible: sorted, searching: false };
    return {
      visible: sorted.filter((s) => listMatches(q, (k) => (indexed.get(s.id) ?? []).some((f) => nameMatches(f, k.name)))),
      searching: true,
    };
  }, [indexed, sorted, search.query]);

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(s: SiteRow) {
    setEditing(s);
    setOpen(true);
  }
  function handleDelete(s: SiteRow) {
    if (!window.confirm(`현장 [${s.name}]을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      const r = await deleteSite(s.id);
      if (r.ok) toast.success("삭제되었습니다");
      else toast.error(r.error);
    });
  }

  const empty =
    sites.length === 0 ? (
      <>
        등록된 현장이 없습니다.{" "}
        <button onClick={openCreate} className="underline">
          신규 추가
        </button>
      </>
    ) : visible.length === 0 ? (
      <>
        ‘{search.query.trim()}’에 맞는 현장이 없습니다.{" "}
        <button onClick={search.clear} className="underline">
          검색 지우기
        </button>
      </>
    ) : null;

  /** 납품 기간 — '05-05 ~ 11-03'(한 번이면 날짜 하나). 없으면 흐리게 '납품 없음'. */
  const period = (s: SiteRow) => {
    const first = firstSaleBySite[s.id];
    const last = lastSaleBySite[s.id];
    if (!first) return <span className="text-xs text-muted-foreground/60">납품 없음</span>;
    return (
      <span className="inline-flex shrink-0 items-center rounded bg-sky-50 px-1.5 text-xs text-sky-700 tabular-nums dark:bg-sky-950/40 dark:text-sky-300" title={`첫 납품 ${first}${last && last !== first ? ` · 최근 납품 ${last}` : ""}`}>
        납품 {shortDate(first)}
        {last && last !== first ? ` ~ ${shortDate(last)}` : ""}
      </span>
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <ListSearch
          search={search}
          placeholder="현장명·지역·시공사 검색"
          label="현장 검색"
          searching={searching}
          shown={visible.length}
          total={sites.length}
        />
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
            신규 현장
          </Button>
        </div>
      </div>

      {view === "card" ? (
        empty ? (
          <div className="rounded-lg border bg-card py-12 text-center text-muted-foreground">{empty}</div>
        ) : (
          // 카드 — 현장명(누르면 상세)·코드·시공사/건축주·지역/주소·납품 기간·상태. 거래처 카드와 같은 크기.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
            {visible.map((s) => {
              const st = STATUS_LABEL[s.status] ?? STATUS_LABEL.active;
              const people = [s.client_name ? `시공 ${s.client_name}` : null, s.owner_name].filter(Boolean).join(" · ");
              const place = [s.city, s.address].filter(Boolean).join(" ");
              return (
                <div key={s.id} className={cn("group relative flex flex-col gap-1 rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/50", s.status === "closed" && "opacity-70")}>
                  <div className="flex items-start gap-1.5">
                    <Link href={`/${book}/sites/${s.id}`} className="min-w-0 flex-1 truncate text-base font-semibold hover:underline" title={s.name}>
                      {s.name}
                    </Link>
                    <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${st.className}`}>{st.label}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.code}</span>
                  </div>
                  {people || place ? (
                    // 시공사·건축주·지역·주소 — 대부분 비어 있어 있을 때만 한 줄
                    <div className="truncate text-sm text-muted-foreground" title={[people, place].filter(Boolean).join(" / ")}>
                      {people || place}
                      {people && place ? <span className="text-muted-foreground/70"> · {place}</span> : null}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    {period(s)}
                    <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <Button size="icon-xs" variant="ghost" onClick={() => openEdit(s)} aria-label="수정" title="수정">
                        <PencilIcon />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => handleDelete(s)} aria-label="삭제" title="삭제">
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">코드</TableHead>
                <TableHead>현장명</TableHead>
                <TableHead className="w-32">지역</TableHead>
                <TableHead>주소</TableHead>
                <TableHead className="w-44">시공사 / 건축주</TableHead>
                <TableHead className="w-40">납품 기간</TableHead>
                <TableHead className="w-20 text-center">상태</TableHead>
                <TableHead className="w-20 text-right">액션</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {empty ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    {empty}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((s) => {
                  const st = STATUS_LABEL[s.status] ?? STATUS_LABEL.active;
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/${book}/sites/${s.id}`} className="hover:underline">
                          {s.code}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/${book}/sites/${s.id}`} className="hover:underline">
                          {s.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{s.city ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.address ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.client_name ? (
                          <div className="text-xs text-muted-foreground">
                            시공 {s.client_name}
                          </div>
                        ) : null}
                        <div>{s.owner_name ?? (s.client_name ? null : "—")}</div>
                      </TableCell>
                      <TableCell>{period(s)}</TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`inline-flex h-5 items-center rounded-full px-2 text-xs ${st.className}`}
                        >
                          {st.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => openEdit(s)}
                            aria-label="수정"
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleDelete(s)}
                            aria-label="삭제"
                          >
                            <Trash2Icon className="text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <SiteFormDialog open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
