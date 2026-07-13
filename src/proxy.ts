import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes: the sign-in surface + machine-to-machine webhooks that carry
// their own auth (Composio HMAC, Bot Framework JWT), not a Clerk session.
const isPublicRoute = createRouteMatcher([
  "/signin(.*)",
  "/api/webhooks(.*)",
  "/api/messages(.*)",
  "/api/cron(.*)",
]);

// AIX Core auth. Unauthenticated users are sent to the configured sign-in with
// a `redirect_url` back to where they were — the Jules pattern
// (app-staging.aiworkforce.md/login?redirect_url=<agent-url>):
//   - staging/prod: NEXT_PUBLIC_CLERK_SIGN_IN_URL = https://app-*.aiworkforce.md/login
//     → Core hosts sign-in; the shared *.aiworkforce.md session returns them here.
//   - local: NEXT_PUBLIC_CLERK_SIGN_IN_URL = /signin → embedded Clerk widget
//     (localhost can't share Core's cross-subdomain cookie).
export const proxy = clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  const { userId } = await auth();
  if (userId) return;

  const signIn = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/signin";
  const dest = /^https?:\/\//.test(signIn)
    ? new URL(signIn) // Core login (absolute, cross-subdomain)
    : new URL(signIn, request.url); // local same-origin page
  dest.searchParams.set("redirect_url", request.url);
  return NextResponse.redirect(dest);
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
