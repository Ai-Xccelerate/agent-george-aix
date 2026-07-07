import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresh Supabase auth tokens on every request and forward updated cookies.
 * Returns either the original response or a redirect when the route is
 * protected and the visitor isn't signed in.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const PUBLIC_PREFIXES = [
    "/signin",
    "/signup",
    "/forgot-password",
    "/auth",
    "/api/webhooks",
    "/api/messages",
    "/_next",
    "/favicon.ico",
  ];
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Don't bounce authed users off /signin — they may lack an org_members row
  // yet. Forcing /dashboard before admission completes causes a redirect loop
  // that leaves the UI stuck on "Rendering…". The app layout admits them.

  return response;
}
