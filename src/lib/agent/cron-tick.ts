/**
 * One cron tick: run due standing jobs, then sweep stuck-pending inbound events.
 *
 * Extracted so it has two callers that can't drift:
 *   - the in-process scheduler (`src/instrumentation.ts`) — the production
 *     trigger on Railway's persistent server, ticking every minute.
 *   - the HTTP route (`/api/cron/run-jobs`) — kept for manual/curl testing.
 *
 * Correctness under concurrent ticks comes from the atomic claim on
 * `agent_jobs.running_run_id` inside `runGeorgeJob` (and the equivalent claim
 * in `processAgentEvent`), so even overlapping ticks can't double-execute work.
 */
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { runGeorgeJob } from "./run-job";
import { processAgentEvent } from "./process-event";
import { computeNextRun } from "./cron";
import { runObjectivesScan, type ObjectivesScanResult } from "./run-objectives-scan";

// Per-tick wall budget. Bounded so a tick can't run forever; leaves headroom
// for the last job to finalize.
const TICK_BUDGET_MS = 240_000;
// Per-job ceiling — multiple short jobs per tick beat one long one.
const PER_JOB_BUDGET_MS = 180_000;
// Belt-and-braces event sweep tuning.
const SWEEP_MAX_PER_TICK = 5;
const STUCK_THRESHOLD_MS = 5 * 60_000; // process anything pending > 5 min

type DueJob = {
  id: string;
  org_id: string;
  cron: string;
  timezone: string | null;
};

export type CronTickResult = {
  started_at: string;
  elapsed_ms: number;
  ran: number;
  deferred: number;
  results: Array<{
    jobId: string;
    status: string;
    runId?: string;
    skipped?: string;
    error?: string;
  }>;
  event_sweep: Array<{
    eventId: string;
    status: string;
    sessionId?: string | null;
    error?: string | null;
  }>;
  objectives_scan: ObjectivesScanResult;
};

export async function runCronTick(): Promise<CronTickResult> {
  const startedAt = Date.now();
  const admin = createSupabaseAdmin();

  const results: CronTickResult["results"] = [];
  let deferred = 0;

  const due = await admin
    .from("agent_jobs")
    .select("id, org_id, cron, timezone")
    .eq("enabled", true)
    .is("running_run_id", null)
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(50);

  if (due.error) {
    throw new Error(`cron tick: loading due jobs failed — ${due.error.message}`);
  }

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

  // Belt-and-braces sweep for stuck-pending agent_events. The webhook handler
  // kicks processing off via `after(...)`; if the process dies before that
  // runs, the row stays 'pending'. This catches them on a later tick. Limited
  // per tick so a backlog doesn't starve the standing-jobs path.
  const eventSweep: CronTickResult["event_sweep"] = [];
  const stuck = await admin
    .from("agent_events")
    .select("id")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString())
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

  // Objectives scan — wake George on objectives whose follow-up clock is due.
  // Runs last so standing jobs + the event sweep get first claim on the budget.
  let objectivesScan: ObjectivesScanResult = {
    customers_processed: 0,
    objectives_due: 0,
    runs: [],
  };
  const budgetLeft = TICK_BUDGET_MS - (Date.now() - startedAt);
  if (budgetLeft > PER_JOB_BUDGET_MS) {
    try {
      objectivesScan = await runObjectivesScan({ budgetMsRemaining: budgetLeft });
    } catch (err) {
      console.error("[cron tick] objectives scan failed", err);
    }
  }

  return {
    started_at: new Date(startedAt).toISOString(),
    elapsed_ms: Date.now() - startedAt,
    ran: results.length,
    deferred,
    results,
    event_sweep: eventSweep,
    objectives_scan: objectivesScan,
  };
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
