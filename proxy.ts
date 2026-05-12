import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Supabase 인증 proxy (Next.js 16 — middleware의 후속 명칭).
 * 모든 요청에서 세션 쿠키 새로고침 + 비로그인 redirect.
 *
 * 참조:
 *   - https://supabase.com/docs/guides/auth/server-side/nextjs
 *   - node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 중요: getUser() 호출하지 않으면 세션 쿠키 새로고침이 안 됨
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute =
    pathname.startsWith("/login") || pathname.startsWith("/auth");

  // 비로그인 → /login (auth 페이지 자체는 제외)
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // 로그인 상태에서 /login 접근 → /all/dashboard 로
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/all/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // 정적 자산·이미지는 제외
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
