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
 * ENABLEMENT CHANGED: the tick now lives in a dedicated worker service
 * (scripts/worker.ts, `pnpm worker`). This in-process scheduler is OFF unless
 * RUN_CRON_IN_PROCESS=true.
 *
 * Explicit rather than implied by which process happened to boot. Two tickers
 * against one database is a duplicate-work bug, and the failure is quiet: both
 * processes look healthy, and only the audit trail shows the same work done
 * twice. A deployment should not be able to fall into that by accident.
 *
 * Kept rather than deleted because local development still wants one process.
 */
export async function register() {
  // Node.js server runtime only — never the edge runtime or the build phase.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Fail the deploy, loudly, if STORAGE_DRIVER=r2 but the R2 variables are
  // incomplete. Deliberately before the scheduler flag: this must run on every
  // boot, not only where the cron is enabled. A half-configured storage driver
  // would otherwise look healthy and only break on someone's first upload — the
  // failure mode this whole switch exists to prevent.
  const { assertStorageConfig } = await import("./lib/storage/r2");
  assertStorageConfig();

  // Default OFF. The worker service owns the tick in every deployed
  // environment; this path exists for a single-process local dev loop.
  const inProcess = process.env.RUN_CRON_IN_PROCESS?.toLowerCase() === "true";
  if (!inProcess) {
    console.log(
      "[scheduler] in-process cron OFF — the worker service owns the tick " +
        "(set RUN_CRON_IN_PROCESS=true to run it here instead)",
    );
    return;
  }

  console.warn(
    "[scheduler] in-process cron ON via RUN_CRON_IN_PROCESS — make sure the " +
      "worker service is NOT also running, or every sweep happens twice",
  );
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
