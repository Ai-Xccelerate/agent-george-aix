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
 * Both states log a `[scheduler] mode=` line on every boot. An unset variable
 * protects nothing you can see — "correctly off" and "never considered" leave
 * identical logs — so the mode is asserted out loud either way, and the ON
 * state is announced in terms of what it will cause.
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
  //
  // The mode line is emitted on EVERY boot, in both states, and is the
  // supported way to answer "is this container ticking?". Reading it beats
  // inferring the answer from an absence of tick activity: a quiet log is also
  // what a ticking-but-idle container looks like, and the two are only
  // distinguishable if the process says which one it is.
  const inProcess = process.env.RUN_CRON_IN_PROCESS?.toLowerCase() === "true";
  const deployed = process.env.NODE_ENV === "production";

  if (!inProcess) {
    console.log(
      "[scheduler] mode=off — in-process cron disabled; the worker service owns " +
        "the tick (set RUN_CRON_IN_PROCESS=true to tick in this container instead)",
    );
    return;
  }

  // Loud by design, and an assertion rather than a silence.
  //
  // Double-ticking was previously prevented only by this variable being
  // unset — protection by absence, the same shape as a placeholder API key
  // that looks configured and is not. Absence is invisible: nothing in any log
  // distinguishes "correctly off" from "nobody thought about it". So the ON
  // state announces itself in terms of its consequence, not its flag value.
  //
  // The failure this guards is specifically quiet. Two tickers against one
  // database both look healthy, neither errors, and the only evidence is the
  // same work appearing twice in the audit trail — which, when the work is
  // "email a customer", is discovered by the customer.
  const rule = "=".repeat(76);
  console.warn(rule);
  console.warn("[scheduler] mode=in-process — THIS CONTAINER IS TICKING");
  console.warn("[scheduler] RUN_CRON_IN_PROCESS=true was set explicitly.");
  console.warn(
    "[scheduler] If the dedicated worker service is ALSO running, every sweep, " +
      "job and queued event is now processed twice — including anything that sends mail.",
  );
  if (deployed) {
    console.warn(
      "[scheduler] NODE_ENV=production. In a deployed environment the worker " +
        "service owns the tick, so this is almost certainly a misconfiguration. " +
        "Unset RUN_CRON_IN_PROCESS unless you are deliberately running without a worker.",
    );
  }
  console.warn(rule);
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
