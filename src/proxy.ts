import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

// Public routes: the sign-in surface + machine-to-machine webhooks that carry
// their own auth (Composio HMAC, Bot Framework JWT), not a Clerk session.
const isPublicRoute = createRouteMatcher([
  "/signin(.*)",
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

// AIX Core auth (Jules pattern): unauthenticated users are redirected to Core's
// sign-in with a redirect_url back to this agent, e.g.
//   app-staging.aiworkforce.md/login?redirect_url=https://george-staging.aiworkforce.md/dashboard
// Core signs them in; the shared *.aiworkforce.md session returns them here.
//   - staging/prod: NEXT_PUBLIC_CLERK_SIGN_IN_URL = https://app-*.aiworkforce.md/login
//   - local:        NEXT_PUBLIC_CLERK_SIGN_IN_URL = /signin (embedded, localhost
//                    can't share Core's cross-subdomain cookie)
export const proxy = clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  const { userId } = await auth();
  if (userId) return;

  const signIn = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/signin";
  const returnUrl = `${publicOrigin(request)}${request.nextUrl.pathname}`;

  if (/^https?:\/\//.test(signIn)) {
    const dest = new URL(signIn); // Core login (absolute)
    dest.searchParams.set("redirect_url", returnUrl);
    return NextResponse.redirect(dest);
  }

  const local = request.nextUrl.clone(); // local same-origin page
  local.pathname = signIn;
  local.search = "";
  return NextResponse.redirect(local);
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
