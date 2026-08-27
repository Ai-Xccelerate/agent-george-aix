/**
 * Reclaiming work abandoned by a process that died mid-run.
 *
 * WHY THIS BECAME NECESSARY WHEN THE CRON MOVED OUT OF THE WEB SERVER
 * Two of George's three locks were released on success or never:
 *
 *   agent_jobs.running_run_id   cleared when the job finishes. If the process
 *                               dies first, the claim is held forever.
 *   agent_events.status         pending -> processing, and the stuck sweep only
 *                               selects 'pending'. A row stranded in
 *                               'processing' is orphaned permanently.
 *
 * In the old in-process cron this was survivable by accident: the web container
 * restarted on every deploy, and a restart is what cleared the in-memory tick
 * guard and got things moving again. Self-healing, for the wrong reason — and
 * the same restart-clears-the-lock behaviour is what released 1,016 queued
 * events at once on 2026-08-20.
 *
 * A dedicated worker restarts rarely. That turns "cleared by the next deploy"
 * into "cleared by nothing", so a single crash silently removes a job from the
 * schedule forever. Moving the cron without time-bounding these claims would
 * trade a loud bug for a quiet one.
 *
 * THE TIMING NEEDED NO MIGRATION
 * Both timestamps already existed. `agent_events.claimed_at` had been stamped
 * since the claim was written and never once read. A job's claim points at an
 * `agent_job_runs` row, which carries `started_at`. The data to decide WHEN to
 * reclaim was already being recorded.
 *
 * WHAT DID NEED ONE: KNOWING WHO HELD IT
 * Releasing an event is a guess that its owner is dead. Usually right, and
 * when it is wrong the old owner wakes up and finishes work a second process
 * has already redone. Migration 0003 added `agent_events.claim_id` so the
 * release can be made real rather than advisory: clearing it here means the
 * abandoned process can no longer write its result over the new run's. The
 * release logs the id it abandoned, so a later "LOST CLAIM" line in
 * process-event.ts can be matched to the reclaim that caused it.
 *
 * RECLAIMS ARE LOUD
 * Every reclaim is logged and counted, and the count rides back in the tick
 * result. A job that needs reclaiming is a job that crashed; if that is silent
 * you learn about it when someone asks why a customer never got their email.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How long a claim may be held before it is presumed dead.
 *
 * Derived, not chosen. The longest legitimate single piece of work is a job run
 * at PER_JOB_BUDGET_MS (180s) or an event processed at PROCESS_TIME_BUDGET_MS
 * (240s), so the floor is 240s. Reclaiming inside that window would take work
 * away from a process still doing it and run it twice — the exact duplicate
 * George must never produce when the work is "email a customer".
 *
 * Tripled for headroom: a run can exceed its budget while an in-flight model
 * call finishes, and a slow database or a paused container adds more. 12
 * minutes is comfortably past any real run and still well inside "somebody
 * would like this to recover today".
 */
const LONGEST_BUDGET_MS = 240_000;
export const RECLAIM_AFTER_MS = LONGEST_BUDGET_MS * 3;

/**
 * How many times one piece of work may be reclaimed before we stop.
 *
 * A job that crashes, is reclaimed, and crashes again is not unlucky — it is
 * broken, and retrying forever burns model spend while hiding the fault. After
 * this many attempts it is failed deliberately and put on the Needs-you queue,
 * where a person sees it.
 */
export const MAX_RECLAIMS = 3;

/**
 * How long the worker waits on a single tick before giving up on it.
 *
 * Lives here rather than in scripts/worker.ts because it is one half of a
 * two-sided contract with RECLAIM_AFTER_MS, and the two must be read together:
 *
 *   TICK_BUDGET_MS (240s)  <  TICK_WATCHDOG_MS (480s)  <  RECLAIM_AFTER_MS (720s)
 *
 * The worker must abandon its own hung tick BEFORE anything is entitled to
 * reclaim the claims that tick still holds. If these two ever crossed, a tick
 * would have its work reclaimed and re-run underneath it while it was still
 * running — the duplicate-send failure this whole module exists to prevent.
 * The test enforces the ordering so a later edit to either number cannot
 * quietly invert it.
 */
export const TICK_WATCHDOG_MS = 480_000;

export type ReclaimResult = {
  /** Job claims released back to the schedule. */
  jobs: number;
  /** Events returned to 'pending' for another attempt. */
  events: number;
  /** Work given up on and escalated after too many attempts. */
  abandoned: number;
};

const EMPTY: ReclaimResult = { jobs: 0, events: 0, abandoned: 0 };

/** Reads the reclaim tally we keep on the event's own payload. */
function reclaimCount(payload: unknown): number {
  const n = (payload as { _reclaims?: unknown } | null)?._reclaims;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Release work whose owner has evidently died, and give up on work that keeps
 * dying. Never throws — a failure here must not take down the tick that calls
 * it, since the tick is also what does the useful work.
 */
export async function reclaimStalled(admin: SupabaseClient): Promise<ReclaimResult> {
  const cutoff = new Date(Date.now() - RECLAIM_AFTER_MS).toISOString();
  const result: ReclaimResult = { ...EMPTY };

  // ---- events stranded in 'processing' -----------------------------------
  try {
    const { data } = await admin
      .from("agent_events")
      .select("id, org_id, event_type, payload, claimed_at, claim_id")
      .eq("status", "processing")
      .lt("claimed_at", cutoff)
      .limit(50);

    for (const row of (data ?? []) as Array<{
      id: string;
      org_id: string;
      event_type: string;
      payload: Record<string, unknown> | null;
      claimed_at: string;
      claim_id: string | null;
    }>) {
      const attempts = reclaimCount(row.payload) + 1;
      const heldFor = Math.round((Date.now() - Date.parse(row.claimed_at)) / 60_000);

      if (attempts > MAX_RECLAIMS) {
        await admin
          .from("agent_events")
          .update({
            status: "failed",
            error: `abandoned after ${MAX_RECLAIMS} reclaims — the process handling this keeps dying`,
            processed_at: new Date().toISOString(),
            claim_id: null,
          })
          .eq("id", row.id);

        await raiseReclaimEscalation(admin, {
          orgId: row.org_id,
          title: `George gave up on a ${row.event_type} event after ${MAX_RECLAIMS} attempts`,
          detail:
            `Event ${row.id} was claimed and abandoned ${MAX_RECLAIMS} times, which means the run ` +
            `handling it crashes rather than fails. It will not be retried. Something in that ` +
            `code path needs looking at before the same thing happens to real customer work.`,
        });

        console.error("[reclaim] abandoned event after repeated failures", {
          id: row.id,
          event_type: row.event_type,
          attempts,
        });
        result.abandoned += 1;
        continue;
      }

      await admin
        .from("agent_events")
        .update({
          status: "pending",
          claimed_at: null,
          // Clearing this is what makes the release real. The next
          // claimant mints a fresh id, so if the process we just gave up
          // on is still alive and finishes later, its terminal write no
          // longer matches and cannot overwrite the new run's result.
          claim_id: null,
          payload: { ...(row.payload ?? {}), _reclaims: attempts },
        })
        .eq("id", row.id);

      console.warn("[reclaim] event released back to pending", {
        id: row.id,
        event_type: row.event_type,
        held_for_minutes: heldFor,
        attempt: attempts,
        // The claim being abandoned. If it turns up later in a
        // "LOST CLAIM" line, these two logs are the same incident.
        abandoned_claim: row.claim_id,
      });
      result.events += 1;
    }
  } catch (err) {
    console.error("[reclaim] event sweep failed", err);
  }

  // ---- jobs holding a claim whose run started too long ago ---------------
  try {
    const { data: claimed } = await admin
      .from("agent_jobs")
      .select("id, org_id, name, running_run_id")
      .not("running_run_id", "is", null)
      .limit(50);

    for (const job of (claimed ?? []) as Array<{
      id: string;
      org_id: string;
      name: string;
      running_run_id: string;
    }>) {
      const { data: run } = await admin
        .from("agent_job_runs")
        .select("id, started_at")
        .eq("id", job.running_run_id)
        .maybeSingle();

      const startedAt = (run as { started_at?: string } | null)?.started_at;
      // A claim pointing at a run row that no longer exists is stale by
      // definition — nothing will ever clear it.
      const age = startedAt ? Date.now() - Date.parse(startedAt) : Infinity;
      if (age < RECLAIM_AFTER_MS) continue;

      // Attempts are counted from the run history rather than a new column:
      // every reclaimed run is marked timed_out, so they are already the tally.
      const { count } = await admin
        .from("agent_job_runs")
        .select("id", { count: "exact", head: true })
        .eq("job_id", job.id)
        .eq("status", "timed_out");
      const attempts = (count ?? 0) + 1;

      if (startedAt) {
        await admin
          .from("agent_job_runs")
          .update({
            status: "timed_out",
            error: "reclaimed — the process running this job died before finishing",
            finished_at: new Date().toISOString(),
          })
          .eq("id", job.running_run_id);
      }

      if (attempts > MAX_RECLAIMS) {
        await admin
          .from("agent_jobs")
          .update({ running_run_id: null, enabled: false })
          .eq("id", job.id);

        await raiseReclaimEscalation(admin, {
          orgId: job.org_id,
          title: `Standing job "${job.name}" disabled after ${MAX_RECLAIMS} crashes`,
          detail:
            `This job has been reclaimed ${MAX_RECLAIMS} times — each run dies before finishing. ` +
            `It has been disabled rather than left retrying, so it is not silently burning model ` +
            `spend. Re-enable it once the cause is understood.`,
        });

        console.error("[reclaim] job disabled after repeated crashes", {
          job: job.name,
          id: job.id,
          attempts,
        });
        result.abandoned += 1;
        continue;
      }

      await admin.from("agent_jobs").update({ running_run_id: null }).eq("id", job.id);

      console.warn("[reclaim] job claim released", {
        job: job.name,
        id: job.id,
        held_for_minutes: Number.isFinite(age) ? Math.round(age / 60_000) : null,
        attempt: attempts,
      });
      result.jobs += 1;
    }
  } catch (err) {
    console.error("[reclaim] job sweep failed", err);
  }

  return result;
}

/** Put a reclaim failure where a person will see it. Best-effort. */
async function raiseReclaimEscalation(
  admin: SupabaseClient,
  args: { orgId: string; title: string; detail: string },
): Promise<void> {
  try {
    await admin.from("escalations").insert({
      org_id: args.orgId,
      title: args.title,
      detail: args.detail,
      recommendation:
        "Check the worker logs around the times this was reclaimed. Repeated reclaims mean the " +
        "process is crashing, not that the work is slow.",
      urgency: "high",
      status: "open",
    });
  } catch (err) {
    console.error("[reclaim] could not raise escalation", err);
  }
}
