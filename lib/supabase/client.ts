"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * 브라우저(client component)용 Supabase 클라이언트.
 * 세션 쿠키를 자동으로 관리한다.
 *
 * 사용:
 *   const supabase = createClient();
 *   const { data } = await supabase.from('sale').select('*');
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
