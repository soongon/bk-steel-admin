"use client";

import { useCallback, useRef, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

/** 목록 즉시 검색 상태 — 검색어·입력칸 ref·지우기(지운 뒤 입력칸에 포커스). 결과 없음 안내의 [검색 지우기]도 clear 를 쓴다. */
export function useListSearch() {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const clear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);
  return { query, setQuery, inputRef, clear };
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
  const { query, setQuery, inputRef, clear } = search;
  return (
    <>
      <div className="relative w-full basis-full sm:w-auto sm:max-w-sm sm:flex-1 sm:basis-auto">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
