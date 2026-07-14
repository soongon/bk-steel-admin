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
export async function fetchJson(url: string, timeoutMs = 12000, bigIntFields: string[] = []): Promise<any> {
  // 타임아웃 필수: data.go.kr이 연결만 잡고 응답을 안 주면(행) 순차 수집 전체가 멈춤.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} (${url.split("?")[0]})`);
    }
    if (bigIntFields.length === 0) return await res.json();
    // 자연키 등 16자리+ 정수는 JS Number 정밀도(~15자리) 초과로 뭉개진다(예: 지수표기).
    // 지정 필드를 JSON.parse 전에 문자열로 감싸 원본 정밀도 보존(source_key 유니크성 유지).
    let text = await res.text();
    for (const f of bigIntFields) {
      text = text.replace(new RegExp(`("${f}"\\s*:\\s*)(\\d{15,})`, "g"), '$1"$2"');
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * fetchJson + 실패 시 재시도. data.go.kr의 간헐적 행(行)·타임아웃·5xx를 흡수.
 * 선형 백오프(delayMs, 2*delayMs…). 끝까지 실패하면 마지막 에러를 던짐(호출부에서 per-단위 catch).
 */
export async function fetchJsonRetry(
  url: string,
  opts: { retries?: number; timeoutMs?: number; delayMs?: number; bigIntFields?: string[] } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { retries = 2, timeoutMs = 12000, delayMs = 600, bigIntFields } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchJson(url, timeoutMs, bigIntFields);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastErr;
}
