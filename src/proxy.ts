import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { coreSignInUrl } from "@/lib/auth/core-signin";

// Public routes: the sign-in surface + machine-to-machine webhooks that carry
// their own auth (Composio HMAC, Bot Framework JWT), not a Clerk session.
const isPublicRoute = createRouteMatcher([
  "/signin(.*)",
  "/api/health(.*)",
  "/api/webhooks(.*)",
  "/api/messages(.*)",
  "/api/cron(.*)",
]);

// The PUBLIC origin of this app. On Railway request.url is the internal
// 0.0.0.0:8080 bind, so we prefer NEXT_PUBLIC_APP_URL / forwarded headers —
// otherwise the redirect_url we hand to Core would be un-returnable.
function publicOrigin(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return host ? `${proto}://${host}` : request.nextUrl.origin;
}

// AIX Core auth (Jules pattern): on a deployed *.aiworkforce.md host,
// unauthenticated users are redirected to Core's sign-in with a redirect_url
// back to this agent, e.g.
//   app-staging.aiworkforce.md/login?redirect_url=https://george-staging.aiworkforce.md/dashboard
// Core signs them in; the shared *.aiworkforce.md session returns them here.
// The destination is derived from NEXT_PUBLIC_CORE_URL (set on staging/prod) by
// coreSignInUrl() — no per-env NEXT_PUBLIC_CLERK_SIGN_IN_URL required. On
// localhost coreSignInUrl() returns null and we fall back to George's embedded
// widget (localhost can't share Core's cross-subdomain cookie).
export const proxy = clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  const { userId } = await auth();
  if (userId) return;

  const origin = publicOrigin(request);
  const core = coreSignInUrl(new URL(origin).host);

  if (core) {
    const dest = new URL(core); // Core login (absolute)
    dest.searchParams.set("redirect_url", `${origin}${request.nextUrl.pathname}`);
    return NextResponse.redirect(dest);
  }

  const local = request.nextUrl.clone(); // localhost: embedded Clerk widget
  local.pathname = "/signin";
  local.search = "";
  return NextResponse.redirect(local);
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
