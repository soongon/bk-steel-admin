/**
 * data.go.kr OpenAPI 공통 — URL 빌더 + JSON fetch.
 */

/**
 * 쿼리스트링 빌더. undefined/빈값은 생략.
 *
 * ⚠️ serviceKey 주의: 공공데이터포털은 '인증키(Encoding)'와 '인증키(Decoding)'를 준다.
 *   여기 searchParams.set 은 값을 1회 인코딩하므로 **Decoding 키**를 넣어야 한다.
 *   Encoding 키를 넣으면 이중 인코딩(%25..)되어 인증 실패 → TODO(키 도착 후) 확인.
 */
export function buildUrl(
  base: string,
  params: Record<string, string | number | undefined>,
): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 외부 OpenAPI 응답은 본질적으로 untyped
export async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} (${url.split("?")[0]})`);
  }
  return res.json();
}
