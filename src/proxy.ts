import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes: the sign-in surface + machine-to-machine webhooks that carry
// their own auth (Composio HMAC, Bot Framework JWT), not a Clerk session.
const isPublicRoute = createRouteMatcher([
  "/signin(.*)",
  "/api/webhooks(.*)",
  "/api/messages(.*)",
  "/api/cron(.*)",
]);

// AIX Core auth: Clerk is the identity source of truth (shared across all AIX
// agents). This replaces the old Supabase session-refresh proxy. Entitlement
// (Core /access) is enforced server-side in getCurrentUser, not here.
export const proxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
