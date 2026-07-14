import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * AIX Core auth (Jules pattern). Every route requires a signed-in Clerk user
 * except the public ones below. There is no George-local login: unauthenticated
 * users are sent to AIX Core (CLERK_SIGN_IN_URL), and Clerk preserves a
 * redirect_url back to George.
 *
 * Uses `auth.protect()` — NOT a manual `if (!userId) redirect(...)`. protect()
 * performs Clerk's cross-subdomain handshake FIRST, so a user already signed in
 * on Core (shared *.aiworkforce.md session) is recognized here instead of being
 * bounced back to Core in a loop. It only redirects genuinely-signed-out users.
 *
 * Public routes: the sign-in surface + machine-to-machine endpoints that carry
 * their own auth (Composio HMAC, Bot Framework JWT) or must answer unauthed
 * (Railway healthcheck).
 */
const isPublicRoute = createRouteMatcher([
  "/signin(.*)",
  "/api/health(.*)",
  "/api/webhooks(.*)",
  "/api/messages(.*)",
  "/api/cron(.*)",
]);

function parseList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

const authorizedParties = parseList(process.env.CLERK_AUTHORIZED_PARTIES);
const signInUrl = process.env.CLERK_SIGN_IN_URL;
const signUpUrl = process.env.CLERK_SIGN_UP_URL;

export const proxy = clerkMiddleware(
  async (auth, request) => {
    if (isPublicRoute(request)) return;
    await auth.protect();
  },
  { authorizedParties, signInUrl, signUpUrl },
);

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
