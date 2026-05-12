/**
 * Cron entry point — Vercel Cron hits this on a schedule (see vercel.json).
 * Picks up any standing jobs whose `next_run_at <= now()` and runs them
 * sequentially under a per-tick time budget. Overlap protection lives in
 * `runGeorgeJob` via an atomic claim on `agent_jobs.running_run_id`.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. We accept
 * either that or `?secret=` so the route is curl-testable from a tunnel.
 */
import { NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { runGeorgeJob } from "@/lib/agent/run-job";
import { processAgentEvent } from "@/lib/agent/process-event";
import { computeNextRun } from "@/lib/agent/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Per-tick wall budget. Leave ~60s headroom under the 300s function cap so
// the last job has time to finalize and we can still write the response.
const TICK_BUDGET_MS = 240_000;
// Per-job ceiling — multiple short jobs per tick beat one long one.
const PER_JOB_BUDGET_MS = 180_000;

type DueJob = {
  id: string;
  org_id: string;
  cron: string;
  timezone: string | null;
};

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

  const startedAt = Date.now();
  const admin = createSupabaseAdmin();

  const due = await admin
    .from("agent_jobs")
    .select("id, org_id, cron, timezone")
    .eq("enabled", true)
    .is("running_run_id", null)
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(50);
  if (due.error) {
    return Response.json({ ok: false, error: due.error.message }, { status: 500 });
  }

  const results: Array<{
    jobId: string;
    status: string;
    runId?: string;
    skipped?: string;
    error?: string;
  }> = [];
  let deferred = 0;

  for (const job of (due.data ?? []) as DueJob[]) {
    if (Date.now() - startedAt > TICK_BUDGET_MS - PER_JOB_BUDGET_MS) {
      deferred += 1;
      continue;
    }

    const result = await runGeorgeJob({
      jobId: job.id,
      trigger: "schedule",
      timeBudgetMs: Math.min(
        PER_JOB_BUDGET_MS,
        TICK_BUDGET_MS - (Date.now() - startedAt),
      ),
    });

    if (result.skipped) {
      results.push({ jobId: job.id, status: "skipped", skipped: result.reason });
      continue;
    }

    // Advance the schedule using org timezone if the job didn't pin its own.
    const tz = await resolveTimezone(admin, job);
    const nextRunAt = computeNextRun(job.cron, tz);
    await admin
      .from("agent_jobs")
      .update({ next_run_at: nextRunAt.toISOString() })
      .eq("id", job.id);

    results.push({
      jobId: job.id,
      status: result.status,
      runId: result.runId,
      error: result.error ?? undefined,
    });
  }

  // Belt-and-braces sweep for stuck-pending agent_events. The webhook
  // handler kicks processing off via `after(...)`; if the function dies
  // before the handler runs, the row stays 'pending'. This catches them
  // on the next tick. Limit to a handful per tick so a backlog doesn't
  // starve the standing-jobs path.
  const eventSweep: Array<{
    eventId: string;
    status: string;
    sessionId?: string | null;
    error?: string | null;
  }> = [];
  const SWEEP_MAX_PER_TICK = 5;
  const STUCK_THRESHOLD_MS = 5 * 60_000; // process anything pending > 5 min
  const stuck = await admin
    .from("agent_events")
    .select("id")
    .eq("status", "pending")
    .lt(
      "created_at",
      new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString(),
    )
    .order("created_at", { ascending: true })
    .limit(SWEEP_MAX_PER_TICK);

  for (const row of (stuck.data ?? []) as Array<{ id: string }>) {
    if (Date.now() - startedAt > TICK_BUDGET_MS - PER_JOB_BUDGET_MS) {
      deferred += 1;
      continue;
    }
    const res = await processAgentEvent(row.id);
    if (res.skipped) {
      eventSweep.push({ eventId: row.id, status: `skipped:${res.reason}` });
    } else {
      eventSweep.push({
        eventId: row.id,
        status: res.status,
        sessionId: res.sessionId,
        error: res.error,
      });
    }
  }

  return Response.json({
    ok: true,
    started_at: new Date(startedAt).toISOString(),
    elapsed_ms: Date.now() - startedAt,
    ran: results.length,
    deferred,
    results,
    event_sweep: eventSweep,
  });
}

async function resolveTimezone(
  admin: ReturnType<typeof createSupabaseAdmin>,
  job: DueJob,
): Promise<string> {
  if (job.timezone) return job.timezone;
  const { data } = await admin
    .from("orgs")
    .select("default_timezone")
    .eq("id", job.org_id)
    .maybeSingle();
  return data?.default_timezone ?? "UTC";
}

