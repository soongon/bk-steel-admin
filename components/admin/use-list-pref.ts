"use client";

import { useSyncExternalStore } from "react";

/**
 * 목록 화면 취향(보기 방식·정렬) — 브라우저에 기억(localStorage). 서버 렌더는 기본값으로 두고 클라이언트가 붙은 뒤
 * 저장값으로 바꾼다(useSyncExternalStore 라 hydration 불일치 없음). 거래처·현장 목록 공용.
 */
const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

export function useListPref<T extends string>(key: string, fallback: T, valid: readonly T[]): [T, (v: T) => void] {
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
