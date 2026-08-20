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
import { syncMailbox, MAILBOX_SYNC_INTERVAL_MS, type MailboxSyncResult } from "./mailbox-sync";
import { syncTranscripts, type TranscriptSyncResult } from "./transcript-sync";
import { runProactiveScan, type ProactiveScanResult } from "./run-proactive-scan";
import { isScribeAvailable } from "@/lib/scribe/client";
import { isNylasEnabled } from "@/lib/nylas/client";
import { georgeOrgId } from "./tenancy";
import {
  activeConnectedAccountId,
  isTriggerActiveFor,
  ensureTrigger,
  composioOrgIdentity,
} from "@/lib/composio/client";

// Per-tick wall budget. Bounded so a tick can't run forever; leaves headroom
// for the last job to finalize.
const TICK_BUDGET_MS = 240_000;
// Per-job ceiling — multiple short jobs per tick beat one long one.
const PER_JOB_BUDGET_MS = 180_000;
// Belt-and-braces event sweep tuning.
const SWEEP_MAX_PER_TICK = 5;
const STUCK_THRESHOLD_MS = 5 * 60_000; // process anything pending > 5 min
// Mailbox mirror throttle interval lives in mailbox-sync.ts (MAILBOX_SYNC_INTERVAL_MS)
// so the UI's "next sync" estimate can't drift from the scheduler's actual cadence.
// Transcript mirror: Scribe finishes processing a meeting a few minutes after
// it ends, so a periodic pull is the right cadence — no real-time webhook.
const TRANSCRIPT_SYNC_INTERVAL_MS = 10 * 60_000;
// Proactive book sweep — heavy (a full autonomous run per org), so infrequent.
const PROACTIVE_SCAN_INTERVAL_MS = 6 * 60 * 60_000;
// Trigger health self-heal — cheap (two Composio API reads per org), so it
// can run fairly often without meaningfully eating the tick budget.
const TRIGGER_HEALTH_INTERVAL_MS = 60 * 60_000;
// Toolkit -> trigger(s) that must stay armed for real-time delivery. Mirrors
// TOOLKIT_TRIGGERS in api/integrations/composio/callback/route.ts, which
// re-arms on every fresh (re)connect; this catches everything else (a
// subscription Microsoft Graph itself let lapse, Composio-side hiccups).
const REQUIRED_TRIGGERS: Record<string, string[]> = {
  outlook: ["OUTLOOK_MESSAGE_TRIGGER"],
};

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
  trigger_health: TriggerHealthResult[];
  errors: string[];
};

export type TriggerHealthResult = {
  org_id: string;
  toolkit: string;
  trigger: string;
  status: "healthy" | "rearmed" | "no_connection" | "rearm_failed";
  detail?: string;
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

  // Trigger health self-heal — cheap; re-arms a real-time webhook that went
  // quiet for a reason other than a fresh (re)connect (which already
  // re-arms itself in the OAuth callback).
  let triggerHealth: TriggerHealthResult[] = [];
  if (TICK_BUDGET_MS - (Date.now() - startedAt) > 20_000) {
    try {
      triggerHealth = await runDueTriggerHealthChecks(admin);
    } catch (err) {
      const msg = `trigger health: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[cron tick] trigger health check failed", err);
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
    trigger_health: triggerHealth,
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
 * Which orgs a sweep should run for.
 *
 * `sharedCredential: true` means one deployment-wide credential serves the
 * sweep — a single Nylas grant, a single Scribe token. Fanning such a sweep out
 * across tenants does not give each tenant its own data; it copies one tenant's
 * data into all of them. See lib/agent/tenancy.ts for what that cost us.
 *
 * Returning an empty list is a deliberate outcome, not a failure: doing nothing
 * beats writing one org's records into another's tables.
 */
async function sweepOrgIds(
  admin: ReturnType<typeof createSupabaseAdmin>,
  opts: { sharedCredential: boolean; label: string },
): Promise<string[]> {
  if (opts.sharedCredential) {
    const own = georgeOrgId();
    if (!own) {
      console.error(
        `[cron tick] ${opts.label} skipped — GEORGE_ORG_ID is unset, and a shared ` +
          `credential must not be fanned out across organisations`,
      );
      return [];
    }
    return [own];
  }
  const { data } = await admin.from("orgs").select("id");
  return (data ?? []).map((o) => (o as { id: string }).id);
}

/**
 * Runs a Scribe transcript sync, throttled on the newest
 * meeting_transcripts.synced_at (0 when none, so a fresh org syncs next tick).
 *
 * Scribe is always a shared credential — there is one workspace token for the
 * whole deployment — so this only ever runs for George's own org.
 */
async function runDueTranscriptSyncs(
  admin: ReturnType<typeof createSupabaseAdmin>,
): Promise<TranscriptSyncResult[]> {
  const orgIds = await sweepOrgIds(admin, {
    sharedCredential: true,
    label: "transcript sync",
  });
  const out: TranscriptSyncResult[] = [];
  for (const orgId of orgIds) {
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
 * Runs a mailbox mirror sync, throttled per org. Orgs with no connected mailbox
 * surface an error inside the result and are skipped next tick by the throttle.
 *
 * Scope depends on the provider, and the difference matters. Nylas is George's
 * own single mailbox — one grant, so one org. Composio connects a separate
 * account per org, so there the fan-out is correct and stays.
 */
async function runDueMailboxSyncs(
  admin: ReturnType<typeof createSupabaseAdmin>,
): Promise<MailboxSyncResult[]> {
  const nylas = isNylasEnabled();
  const orgIds = await sweepOrgIds(admin, {
    sharedCredential: nylas,
    label: "mailbox sync",
  });
  const out: MailboxSyncResult[] = [];
  for (const orgId of orgIds) {

    // Throttle on ATTEMPT, not last success. The throttle used to key on
    // mail_folders.synced_at — but a sync that fails before it writes any
    // folder (e.g. a broken/expired connection makes OUTLOOK_LIST_MAIL_FOLDERS
    // throw) never updates synced_at, so lastMs stayed 0 and that org retried
    // EVERY tick (60s), stack-dumping each time. Stamping the attempt in
    // agent_scan_state backs off success and failure alike to the interval.
    const { data: state } = await admin
      .from("agent_scan_state")
      .select("last_run_at")
      .eq("org_id", orgId)
      .eq("kind", "mailbox_sync")
      .maybeSingle();
    const lastMs = state?.last_run_at ? Date.parse(state.last_run_at as string) : 0;
    if (Date.now() - lastMs < MAILBOX_SYNC_INTERVAL_MS) continue;
    await admin
      .from("agent_scan_state")
      .upsert(
        { org_id: orgId, kind: "mailbox_sync", last_run_at: new Date().toISOString() },
        { onConflict: "org_id,kind" },
      );

    // Skip orgs with no active mailbox connection: calling Composio for them
    // just throws and spams the log. Same guard the trigger-health check uses.
    //
    // Composio only. On the Nylas path there is no connected account to look up
    // — George owns the mailbox — and this gate would skip every org, silently
    // disabling the mirror.
    if (!nylas && !(await activeConnectedAccountId(orgId, "outlook"))) continue;
    out.push(await syncMailbox(orgId));
  }
  return out;
}

/**
 * Confirms each org's required triggers (REQUIRED_TRIGGERS) are still armed
 * against its *current* connected account, and re-arms any that aren't.
 * Throttled per-org via agent_scan_state(kind='trigger_health') since it's
 * an external API round-trip, not free.
 */
async function runDueTriggerHealthChecks(
  admin: ReturnType<typeof createSupabaseAdmin>,
): Promise<TriggerHealthResult[]> {
  const { data: orgs } = await admin.from("orgs").select("id");
  const out: TriggerHealthResult[] = [];

  for (const org of orgs ?? []) {
    const orgId = org.id as string;
    const { data: state } = await admin
      .from("agent_scan_state")
      .select("last_run_at")
      .eq("org_id", orgId)
      .eq("kind", "trigger_health")
      .maybeSingle();
    const lastMs = state?.last_run_at ? Date.parse(state.last_run_at as string) : 0;
    if (Date.now() - lastMs < TRIGGER_HEALTH_INTERVAL_MS) continue;

    await admin
      .from("agent_scan_state")
      .upsert(
        { org_id: orgId, kind: "trigger_health", last_run_at: new Date().toISOString() },
        { onConflict: "org_id,kind" },
      );

    for (const [toolkit, triggers] of Object.entries(REQUIRED_TRIGGERS)) {
      const connectedAccountId = await activeConnectedAccountId(orgId, toolkit);
      if (!connectedAccountId) {
        // Not connected at all — nothing to arm, and not this check's job to
        // flag (settings/integrations already surfaces connection state).
        continue;
      }
      for (const triggerName of triggers) {
        const healthy = await isTriggerActiveFor(triggerName, connectedAccountId);
        if (healthy) {
          out.push({ org_id: orgId, toolkit, trigger: triggerName, status: "healthy" });
          continue;
        }
        const rearm = await ensureTrigger(
          triggerName,
          connectedAccountId,
          composioOrgIdentity(orgId),
        );
        out.push({
          org_id: orgId,
          toolkit,
          trigger: triggerName,
          status: rearm.ok ? "rearmed" : "rearm_failed",
          detail: rearm.ok ? undefined : rearm.error,
        });
        await admin.from("audit_log").insert({
          org_id: orgId,
          actor: "system",
          action: rearm.ok ? "integration.trigger_rearmed" : "integration.trigger_failed",
          payload: { toolkit, trigger: triggerName, connected_account_id: connectedAccountId, error: rearm.ok ? undefined : rearm.error },
        });
      }
    }
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
