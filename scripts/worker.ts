/**
 * George's background worker — the scheduled half of the system, as its own
 * Railway service.
 *
 * WHY THIS IS NOT INSIDE THE WEB SERVER ANY MORE
 * The tick used to run in-process in the Next.js container. That container
 * restarts on every deploy, and a restart cleared the in-memory guard that
 * decided whether a tick was already running. On 2026-08-20 that sequence
 * released a queue of 1,016 events the moment a deploy landed, and George
 * emailed sixteen colleagues.
 *
 * Phase 1 depends on scheduled sends existing as agent_jobs rows. A runner that
 * a front-end deploy can kill mid-flight is not a runner you can schedule
 * customer email on.
 *
 * SAME LOGIC, NOT A FORK
 * This calls runCronTick() — the identical function the in-process scheduler
 * called. Nothing about the work is duplicated here; if it were, the two copies
 * would drift and only one of them would get the next fix.
 *
 * The tick has no Next.js dependency: cron-tick, run-job, run-autonomous,
 * process-event, both syncs and both scans import nothing from `next/`, which
 * is why a plain Node process can drive it with no shim.
 */
import { assertStorageConfig } from "../src/lib/storage/r2";
import { TICK_WATCHDOG_MS } from "../src/lib/agent/reclaim";
import { runCronTick } from "../src/lib/agent/cron-tick";

const TICK_INTERVAL_MS = 60_000;

/**
 * The tick watchdog lives in lib/agent/reclaim.ts, next to RECLAIM_AFTER_MS.
 *
 * runCronTick() budgets itself at TICK_BUDGET_MS (240s), but that budget is
 * only consulted BETWEEN pieces of work — a single call that never returns
 * sails straight past it. An unreachable DATABASE_URL does exactly that: the
 * tick blocked for over five minutes in testing rather than failing fast.
 *
 * In the old in-process cron that was survivable, because the next deploy
 * restarted the container. A worker has no such thing, so one hung call would
 * latch `ticking` true and the service would go quiet forever while looking
 * perfectly healthy.
 */

let ticking = false;
let stopping = false;

/**
 * One tick.
 *
 * The in-memory guard is unchanged in spirit — it stops sweeps stacking inside
 * THIS process — but it is no longer the thing protecting correctness. That is
 * the time-bounded claims in lib/agent/reclaim.ts, which survive this process
 * dying. The guard is an optimisation; the claims are the guarantee.
 */
async function tick(): Promise<void> {
  if (ticking) {
    console.log("[worker] tick skipped — previous tick still running");
    return;
  }
  ticking = true;
  const startedAt = Date.now();
  let watchdog: NodeJS.Timeout | undefined;
  try {
    // The tick is raced, not cancelled — there is no way to abort work already
    // in flight. If the watchdog wins we stop WAITING on it and let the next
    // tick proceed; the abandoned call still holds its database claims, so it
    // cannot be double-processed, and reclaim.ts collects them if it never
    // recovers.
    const res = await Promise.race([
      runCronTick(),
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(
          () =>
            reject(
              new Error(
                `tick exceeded the ${TICK_WATCHDOG_MS / 1000}s watchdog — something is not returning ` +
                  `(an unreachable database does this). Abandoning the wait so the worker keeps ticking.`,
              ),
            ),
          TICK_WATCHDOG_MS,
        );
      }),
    ]);
    const didSomething =
      res.ran > 0 ||
      res.deferred > 0 ||
      res.event_sweep.length > 0 ||
      res.objectives_scan.customers_processed > 0 ||
      res.reclaimed.jobs > 0 ||
      res.reclaimed.events > 0 ||
      res.reclaimed.abandoned > 0 ||
      res.silence.marked > 0 ||
      res.silence.escalated > 0 ||
      // A blocked sweep is never a quiet tick. "Nothing happened" and
      // "nothing CAN happen" looked identical for nine days.
      res.blocked.length > 0;

    if (didSomething || process.env.SCHEDULER_VERBOSE?.toLowerCase() === "true") {
      console.log("[worker] tick done", {
        ran: res.ran,
        deferred: res.deferred,
        swept: res.event_sweep.length,
        objectives: res.objectives_scan.customers_processed,
        reclaimed: res.reclaimed,
        silence: res.silence,
        ...(res.blocked.length ? { BLOCKED: res.blocked } : {}),
        ms: res.elapsed_ms,
      });
    }
  } catch (err) {
    // Never let one bad tick end the process: the next one may well succeed,
    // and a crash-looping worker is harder to diagnose than a logged failure.
    console.error("[worker] tick failed", err, { after_ms: Date.now() - startedAt });
  } finally {
    if (watchdog) clearTimeout(watchdog);
    ticking = false;
  }
}

async function main(): Promise<void> {
  // Same fail-fast the web server does on boot. A half-configured storage
  // driver must break here rather than at somebody's first upload.
  assertStorageConfig();

  console.log("[worker] starting", {
    interval_ms: TICK_INTERVAL_MS,
    node_env: process.env.NODE_ENV ?? "(unset)",
    mail_provider: process.env.MAIL_PROVIDER ?? "(unset — inferred)",
  });

  const timer = setInterval(() => {
    if (!stopping) void tick();
  }, TICK_INTERVAL_MS);

  // Railway sends SIGTERM on redeploy. Finish the tick in flight rather than
  // dying mid-run and leaving a claim to be reclaimed twelve minutes later.
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received — finishing the current tick, then exiting`);
    clearInterval(timer);

    const waitedFrom = Date.now();
    const check = setInterval(() => {
      if (!ticking) {
        clearInterval(check);
        console.log("[worker] stopped cleanly");
        process.exit(0);
      }
      // Railway's grace period is finite; do not pretend otherwise.
      if (Date.now() - waitedFrom > 25_000) {
        clearInterval(check);
        console.warn("[worker] tick still running at shutdown — exiting, claim will be reclaimed");
        process.exit(0);
      }
    }, 500);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Tick once immediately so a deploy does not idle for a minute.
  void tick();
}

void main();
