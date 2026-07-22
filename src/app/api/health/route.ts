// Liveness endpoint for Railway's healthcheck. Must always return 200 without
// auth or redirects — it is deliberately decoupled from the sign-in flow (the
// healthcheck used to point at /signin, which now redirects to AIX Core on
// deployed hosts). Public route (see proxy.ts isPublicRoute).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true });
}
