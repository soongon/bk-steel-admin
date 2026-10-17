"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

// 탭 안 기억(sessionStorage) — 목록마다 마지막 검색어와, 목록을 떠나 간 화면. 상세의 [목록] 버튼(ListBackLink)이 쓴다.
const queryKey = (path: string) => `list-q:${path}`;
const leftKey = (path: string) => `list-left:${path}`;

function store(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // 저장소를 못 쓰는 환경 — [목록] 버튼만 검색어 없이 돌아간다.
  }
}

function stored(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/**
 * 주소의 ?q= 를 검색어로 맞춘다 — 그 목록 화면에 있고 q 가 다를 때만. 서버를 다시 부르지 않는 replaceState.
 * 주소는 목록 경로 + q 로만 만든다(명함 등록 ?from_card= 처럼 잠깐 붙었던 값이 되살아나지 않게). 실제로 적었으면 true.
 */
function writeQueryParam(path: string, q: string): boolean {
  if (window.location.pathname !== path) return false; // 이미 다른 화면으로 넘어갔으면 손대지 않는다
  if ((new URLSearchParams(window.location.search).get("q") ?? "") === q) return false;
  try {
    window.history.replaceState(null, "", q ? `${path}?${new URLSearchParams({ q })}` : path);
  } catch {
    // 브라우저가 잦은 주소 변경을 막으면(사파리) 이번 것만 건너뛴다 — 검색은 그대로, 주소는 다음 번에 맞춘다.
  }
  return true;
}

/**
 * 목록 즉시 검색 상태 — 검색어·입력칸 ref·지우기(지운 뒤 입력칸에 포커스). 결과 없음 안내의 [검색 지우기]도 clear 를 쓴다.
 * 검색어는 주소 ?q= 에도 남긴다(치다 멈추면, 입력칸을 벗어나면 바로) — 상세로 들어갔다 뒤로 오거나 새로고침해도 같은 검색.
 * 주소가 밖에서 바뀌면(같은 목록 메뉴를 다시 눌러 ?q= 가 빠짐, 뒤로·앞으로 가기) 입력칸이 주소를 따라간다.
 * 키마다 주소를 바꾸지 않는 건 사파리가 잦은 주소 변경을 막기 때문.
 */
export function useListSearch() {
  const urlQuery = useSearchParams().get("q") ?? "";
  const [listPath] = useState(usePathname()); // 이 목록의 주소 — 다른 화면으로 넘어간 뒤엔 주소를 건드리지 않게
  const [query, setQuery] = useState(urlQuery);
  // 주소의 q 가 바뀌었을 때 우리가 적은 값(pending)이 돌아온 거면 그대로, 아니면 바깥에서 바뀐 것 — 입력칸을 맞춘다.
  const [seenUrl, setSeenUrl] = useState(urlQuery);
  const [pending, setPending] = useState<string[]>([]);
  if (urlQuery !== seenUrl) {
    setSeenUrl(urlQuery);
    const i = pending.indexOf(urlQuery);
    if (i >= 0) {
      setPending(pending.slice(i + 1));
    } else {
      setPending([]);
      setQuery(urlQuery);
    }
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const clear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);
  const save = useCallback(
    (q: string) => {
      if (writeQueryParam(listPath, q)) setPending((p) => [...p, q]);
    },
    [listPath],
  );
  // 탭 기억은 바로, 주소는 치다 멈추면.
  useEffect(() => {
    store(queryKey(listPath), query);
    const t = setTimeout(() => save(query), 400);
    return () => clearTimeout(t);
  }, [listPath, query, save]);
  // 목록을 떠날 때 간 화면을 적어 둔다 — [목록] 버튼은 그 상세에서만 검색어를 붙인다(다른 길로 온 상세에서 옛 검색이 되살아나지 않게).
  useEffect(() => () => store(leftKey(listPath), window.location.pathname), [listPath]);
  const saveToUrl = useCallback(() => save(query), [save, query]);
  return { query, setQuery, inputRef, clear, saveToUrl };
}

export type ListSearchState = ReturnType<typeof useListSearch>;

/**
 * 목록 즉시 검색칸(넷플릭스식) + 건수 — 치는 대로 부모가 목록을 거른다(검색 버튼 없음).
 * X·Esc 로 지우기, Enter(휴대폰 키보드 '검색')는 키보드를 내려 결과가 보이게. 건수는 스크린리더에도 알린다.
 * 부모의 flex-wrap 툴바 안에 [검색칸][건수] 두 칸으로 들어간다 — 좁은 화면에선 검색칸이 한 줄을 다 쓰고
 * 건수·버튼은 다음 줄(입력 중 건수 글자가 길어져도 검색칸 폭이 줄지 않게).
 */
export function ListSearch({
  search,
  placeholder,
  label,
  searching,
  shown,
  total,
}: {
  search: ListSearchState;
  placeholder: string;
  label: string;
  searching: boolean; // 실제로 거르는 중인지(기호만 친 경우 등은 false → '총 N건')
  shown: number;
  total: number;
}) {
  const { query, setQuery, inputRef, clear, saveToUrl } = search;
  return (
    <>
      <div className="relative w-full basis-full sm:w-auto sm:max-w-sm sm:flex-1 sm:basis-auto">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={saveToUrl}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return; // 한글 조합 중 키는 입력기 몫
            if (e.key === "Escape" && query) clear();
            else if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder={placeholder}
          aria-label={label}
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          className="pr-9 pl-8"
        />
        {query ? (
          <button
            type="button"
            onClick={clear}
            aria-label="검색어 지우기"
            className="absolute top-1/2 right-0.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>
      <p className="shrink-0 text-sm text-muted-foreground" aria-live="polite">
        {searching ? (
          <>
            검색 <span className="font-medium text-foreground">{shown}</span>건 / 전체 {total}건
          </>
        ) : (
          <>
            총 <span className="font-medium text-foreground">{total}</span>건
          </>
        )}
      </p>
    </>
  );
}

const noSubscribe = () => () => {};

/**
 * 목록으로 돌아가는 링크 — 그 목록에서 이 상세로 왔으면 마지막 검색어(?q=)를 붙여, 브라우저 뒤로 가기가 아니어도 검색이 그대로 남게.
 * 매출 등 다른 길로 온 상세에서는 검색어 없이 목록 전체로.
 */
export function ListBackLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const pathname = usePathname();
  const q = useSyncExternalStore(
    noSubscribe,
    () => (stored(leftKey(href)) === pathname ? stored(queryKey(href)) : ""),
    () => "",
  );
  return <Link href={q ? `${href}?${new URLSearchParams({ q })}` : href} {...props} />;
}
