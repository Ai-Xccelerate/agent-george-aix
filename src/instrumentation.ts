/**
 * Next.js instrumentation — runs once when the server process boots.
 *
 * On Railway we run a single persistent Node server, so the production cron
 * "tick" is driven HERE, in-process (node-cron), rather than by an external
 * pinger hitting /api/cron/run-jobs. This is the honest use of a persistent
 * host: no second service, no shared secret round-trip, no Vercel-Cron mimicry.
 *
 * Correctness under any future concurrency (overlapping ticks, multiple
 * replicas) is guaranteed by the atomic claim on `agent_jobs.running_run_id`
 * inside the job runner — so this scheduler only needs to be simple, not
 * exclusive. The in-process `ticking` guard below is just to avoid stacking
 * sweeps within a single process.
 *
 * Enablement: ON by default in production; OFF in dev unless SCHEDULER_ENABLED
 * is set (so local dev doesn't fire real jobs against real data by surprise).
 * Set SCHEDULER_ENABLED=false to disable in prod (e.g. when moving the tick to
 * a dedicated Railway cron service at scale).
 */
export async function register() {
  // Node.js server runtime only — never the edge runtime or the build phase.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const flag = process.env.SCHEDULER_ENABLED;
  const enabled = flag
    ? flag.toLowerCase() === "true"
    : process.env.NODE_ENV === "production";
  if (!enabled) {
    console.log(
      "[scheduler] disabled — set SCHEDULER_ENABLED=true to run the in-process cron locally",
    );
    return;
  }

  // Dynamic imports so node-cron and the DB-touching tick logic never load in
  // the edge runtime or during build.
  const { schedule } = await import("node-cron");
  const { runCronTick } = await import("./lib/agent/cron-tick");

  let ticking = false;
  console.log("[scheduler] in-process cron starting — ticking every minute");

  schedule("* * * * *", async () => {
    if (ticking) {
      console.log("[scheduler] tick skipped — previous tick still running");
      return;
    }
    ticking = true;
    try {
      const res = await runCronTick();
      // Only log ticks that did something, to keep the log readable. Set
      // SCHEDULER_VERBOSE=true to log every tick (handy for verifying the
      // scheduler is alive).
      const verbose = process.env.SCHEDULER_VERBOSE?.toLowerCase() === "true";
      if (
        verbose ||
        res.ran > 0 ||
        res.event_sweep.length > 0 ||
        res.deferred > 0 ||
        res.objectives_scan.customers_processed > 0
      ) {
        console.log("[scheduler] tick done", {
          ran: res.ran,
          deferred: res.deferred,
          swept: res.event_sweep.length,
          objectives: res.objectives_scan.customers_processed,
          ms: res.elapsed_ms,
        });
      }
    } catch (err) {
      console.error("[scheduler] tick failed", err);
    } finally {
      ticking = false;
    }
  });
}
