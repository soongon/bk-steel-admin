import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * 서버(server component / route handler / server action)용 Supabase 클라이언트.
 * 쿠키 기반 세션을 Next.js 16의 async cookies API와 연동.
 *
 * 사용:
 *   const supabase = await createClient();
 *   const { data } = await supabase.from('sale').select('*');
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component에서는 set 호출이 무시됨 (정상). middleware/route handler에서만 동작.
          }
        },
      },
    },
  );
}
