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
import { syncMailbox, type MailboxSyncResult } from "./mailbox-sync";
import { syncTranscripts, type TranscriptSyncResult } from "./transcript-sync";
import { runProactiveScan, type ProactiveScanResult } from "./run-proactive-scan";
import { isScribeAvailable } from "@/lib/scribe/client";

// Per-tick wall budget. Bounded so a tick can't run forever; leaves headroom
// for the last job to finalize.
const TICK_BUDGET_MS = 240_000;
// Per-job ceiling — multiple short jobs per tick beat one long one.
const PER_JOB_BUDGET_MS = 180_000;
// Belt-and-braces event sweep tuning.
const SWEEP_MAX_PER_TICK = 5;
const STUCK_THRESHOLD_MS = 5 * 60_000; // process anything pending > 5 min
// Mailbox mirror is throttled: the OUTLOOK webhook handles real-time arrival,
// so the delta-based catch-up only needs to run periodically, not every tick.
const MAILBOX_SYNC_INTERVAL_MS = 10 * 60_000;
// Transcript mirror: Scribe finishes processing a meeting a few minutes after
// it ends, so a periodic pull is the right cadence — no real-time webhook.
const TRANSCRIPT_SYNC_INTERVAL_MS = 10 * 60_000;
// Proactive book sweep — heavy (a full autonomous run per org), so infrequent.
const PROACTIVE_SCAN_INTERVAL_MS = 6 * 60 * 60_000;

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
  mailbox_sync: MailboxSyncResult[];
  transcript_sync: TranscriptSyncResult[];
  proactive_scan: ProactiveScanResult[];
  errors: string[];
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
  const errors: string[] = [];

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
      const msg = `objectives scan: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[cron tick] objectives scan failed", err);
      errors.push(msg);
    }
  }

  // Mailbox + calendar mirror — throttled catch-up sync per org.
  let mailboxSync: MailboxSyncResult[] = [];
  if (TICK_BUDGET_MS - (Date.now() - startedAt) > 20_000) {
    try {
      mailboxSync = await runDueMailboxSyncs(admin);
    } catch (err) {
      const msg = `mailbox sync: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[cron tick] mailbox sync failed", err);
      errors.push(msg);
    }
  }

  // Scribe transcript mirror — throttled catch-up sync per org.
  let transcriptSync: TranscriptSyncResult[] = [];
  if (isScribeAvailable() && TICK_BUDGET_MS - (Date.now() - startedAt) > 20_000) {
    try {
      transcriptSync = await runDueTranscriptSyncs(admin);
    } catch (err) {
      const msg = `transcript sync: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[cron tick] transcript sync failed", err);
      errors.push(msg);
    }
  }

  // Proactive book sweep — heavy; only with a full job's worth of budget left.
  // One org per tick at most; the throttle keeps the rest due for later ticks.
  let proactiveScan: ProactiveScanResult[] = [];
  if (TICK_BUDGET_MS - (Date.now() - startedAt) > PER_JOB_BUDGET_MS) {
    try {
      proactiveScan = await runDueProactiveScans(
        admin,
        TICK_BUDGET_MS - (Date.now() - startedAt),
      );
    } catch (err) {
      const msg = `proactive scan: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[cron tick] proactive scan failed", err);
      errors.push(msg);
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
    mailbox_sync: mailboxSync,
    transcript_sync: transcriptSync,
    proactive_scan: proactiveScan,
    errors,
  };
}

/**
 * Runs the proactive scan for at most one due org per tick (it's a full
 * autonomous run). Throttle keyed on agent_scan_state(kind='proactive').
 */
async function runDueProactiveScans(
  admin: ReturnType<typeof createSupabaseAdmin>,
  budgetMsLeft: number,
): Promise<ProactiveScanResult[]> {
  const { data: orgs } = await admin.from("orgs").select("id");
  for (const org of orgs ?? []) {
    const orgId = org.id as string;
    const { data: state } = await admin
      .from("agent_scan_state")
      .select("last_run_at")
      .eq("org_id", orgId)
      .eq("kind", "proactive")
      .maybeSingle();
    const lastMs = state?.last_run_at ? Date.parse(state.last_run_at as string) : 0;
    if (Date.now() - lastMs < PROACTIVE_SCAN_INTERVAL_MS) continue;

    // Claim the slot first so a crashing run doesn't respin every tick.
    await admin
      .from("agent_scan_state")
      .upsert(
        { org_id: orgId, kind: "proactive", last_run_at: new Date().toISOString() },
        { onConflict: "org_id,kind" },
      );
    const result = await runProactiveScan(orgId, {
      timeBudgetMs: Math.min(PER_JOB_BUDGET_MS, budgetMsLeft),
    });
    return [result]; // one org per tick
  }
  return [];
}

/**
 * Runs a Scribe transcript sync for each org whose last sync is older than the
 * throttle interval. Throttle keys on the newest meeting_transcripts.synced_at
 * (0 when none, so a fresh org syncs on the next tick).
 */
async function runDueTranscriptSyncs(
  admin: ReturnType<typeof createSupabaseAdmin>,
): Promise<TranscriptSyncResult[]> {
  const { data: orgs } = await admin.from("orgs").select("id");
  const out: TranscriptSyncResult[] = [];
  for (const org of orgs ?? []) {
    const orgId = org.id as string;
    const { data: latest } = await admin
      .from("meeting_transcripts")
      .select("synced_at")
      .eq("org_id", orgId)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastMs = latest?.synced_at ? Date.parse(latest.synced_at as string) : 0;
    if (Date.now() - lastMs < TRANSCRIPT_SYNC_INTERVAL_MS) continue;
    out.push(await syncTranscripts(orgId));
  }
  return out;
}

/**
 * Runs a mailbox mirror sync for each org whose last sync is older than the
 * throttle interval. Orgs with no connected mailbox surface an error inside
 * the result and are skipped next tick by the same throttle.
 */
async function runDueMailboxSyncs(
  admin: ReturnType<typeof createSupabaseAdmin>,
): Promise<MailboxSyncResult[]> {
  const { data: orgs } = await admin.from("orgs").select("id");
  const out: MailboxSyncResult[] = [];
  for (const org of orgs ?? []) {
    const orgId = org.id as string;
    const { data: latest } = await admin
      .from("mail_folders")
      .select("synced_at")
      .eq("org_id", orgId)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastMs = latest?.synced_at ? Date.parse(latest.synced_at as string) : 0;
    if (Date.now() - lastMs < MAILBOX_SYNC_INTERVAL_MS) continue;
    out.push(await syncMailbox(orgId));
  }
  return out;
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
