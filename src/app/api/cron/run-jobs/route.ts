/**
 * Cron HTTP entry point — kept for manual / curl testing.
 *
 * In production on Railway the tick is driven IN-PROCESS by the persistent
 * server's scheduler (`src/instrumentation.ts`), not by this route. The route
 * stays so the tick can be triggered by hand (e.g. from a tunnel) and so the
 * logic has a stable, testable surface. The actual orchestration lives in
 * `runCronTick()` (`src/lib/agent/cron-tick.ts`) — shared by both callers so
 * they can't drift.
 *
 * Auth: caller sends `Authorization: Bearer <CRON_SECRET>` (or `?secret=`).
 */
import { NextRequest } from "next/server";
import { runCronTick } from "@/lib/agent/cron-tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not set on this deployment." },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const querySecret = new URL(req.url).searchParams.get("secret");
  const provided = auth.replace(/^Bearer\s+/i, "") || querySecret;
  if (provided !== secret) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runCronTick();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
