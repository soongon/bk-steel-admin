"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import { nameKeys, nameMatches } from "@/lib/search";
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

export function SiteTable({
  sites,
  firstSaleBySite,
}: {
  sites: SiteRow[];
  firstSaleBySite: Record<string, string>;
}) {
  const params = useParams<{ book: string }>();
  const book = params.book ?? "all";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [, startTransition] = useTransition();

  // 즉시 검색 — 표에 보이는 글자(현장명·지역·주소·시공사·건축주)로, 한글 조합 중에도 좁혀짐. 현장엔 전화번호 칸이 없다.
  const search = useListSearch();
  const indexed = useMemo(
    () => sites.map((s) => ({ s, keys: [s.name, s.city, s.address, s.client_name, s.owner_name].map(nameKeys) })),
    [sites],
  );
  const { visible, searching } = useMemo(() => {
    const q = nameKeys(search.query);
    if (q[0] === "") return { visible: sites, searching: false };
    return { visible: indexed.filter(({ keys }) => keys.some((k) => nameMatches(k, q))).map(({ s }) => s), searching: true };
  }, [indexed, sites, search.query]);

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
        <Button onClick={openCreate} size="sm" className="ml-auto">
          <PlusIcon className="size-4" />
          신규 현장
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">코드</TableHead>
              <TableHead>현장명</TableHead>
              <TableHead className="w-32">지역</TableHead>
              <TableHead>주소</TableHead>
              <TableHead className="w-44">시공사 / 건축주</TableHead>
              <TableHead className="w-28">첫 납품일</TableHead>
              <TableHead className="w-20 text-center">상태</TableHead>
              <TableHead className="w-20 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  등록된 현장이 없습니다.{" "}
                  <button onClick={openCreate} className="underline">
                    신규 추가
                  </button>
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  ‘{search.query.trim()}’에 맞는 현장이 없습니다.{" "}
                  <button onClick={search.clear} className="underline">
                    검색 지우기
                  </button>
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
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {firstSaleBySite[s.id]
                        ? `${firstSaleBySite[s.id].replaceAll("-", ".")} ~`
                        : "—"}
                    </TableCell>
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

      <SiteFormDialog open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
