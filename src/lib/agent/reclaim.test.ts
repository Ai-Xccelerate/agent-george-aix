/**
 * Reclaiming work abandoned by a dead process.
 *
 * This exists because moving the cron into a dedicated worker changes the
 * character of a stuck lock. In the web container a stuck claim was cleared by
 * the next deploy — self-healing for the wrong reason. A worker restarts
 * rarely, so the same claim would be held forever and the job would silently
 * leave the schedule.
 *
 * Two properties matter more than the rest:
 *
 *   the window must EXCEED the longest legitimate run, or we reclaim work that
 *   is still in progress and do it twice — unacceptable when the work is
 *   "email a customer";
 *
 *   repeated failures must STOP, not loop, or a crashing job burns model spend
 *   quietly forever.
 */
import { describe, expect, it } from "vitest";
import { MAX_RECLAIMS, RECLAIM_AFTER_MS, TICK_WATCHDOG_MS, reclaimStalled } from "./reclaim";

const ORG = "11111111-1111-1111-1111-111111111111";
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Records writes; serves one stranded event and/or one claimed job. */
function db(opts: {
  events?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  run?: Record<string, unknown> | null;
  timedOutRuns?: number;
}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean }) => {
          if (o?.head) {
            return {
              eq: () => ({
                eq: async () => ({ count: opts.timedOutRuns ?? 0, error: null }),
              }),
            };
          }
          return chain;
        },
        eq: () => chain,
        not: () => chain,
        lt: () => chain,
        limit: async () =>
          table === "agent_events"
            ? { data: opts.events ?? [], error: null }
            : { data: opts.jobs ?? [], error: null },
        maybeSingle: async () => ({ data: opts.run ?? null, error: null }),
        update: (payload: Record<string, unknown>) => {
          updates.push({ table, payload });
          return { eq: async () => ({ error: null }) };
        },
        insert: async (payload: Record<string, unknown>) => {
          inserts.push({ table, payload });
          return { error: null };
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { admin, updates, inserts };
}

describe("the window must not reclaim live work", () => {
  it("exceeds the longest legitimate run", () => {
    // Job budget is 180s and event processing 240s. Reclaiming inside that
    // takes work off a process still doing it and runs it twice.
    const longestBudget = 240_000;
    expect(RECLAIM_AFTER_MS).toBeGreaterThan(longestBudget);
  });

  it("leaves real headroom rather than sitting just past the budget", () => {
    // A run can overrun while an in-flight model call finishes.
    expect(RECLAIM_AFTER_MS).toBeGreaterThanOrEqual(240_000 * 3);
  });

  it("still recovers within a working day, not a week", () => {
    expect(RECLAIM_AFTER_MS).toBeLessThan(60 * 60_000);
  });

  it("gives up on a hung tick before anything may reclaim that tick's work", () => {
    // The ordering that must hold, discovered the hard way: pointing the tick
    // at an unreachable database made runCronTick() block past five minutes
    // instead of failing, because its own budget is only checked BETWEEN
    // pieces of work.
    //
    //   tick budget (240s) < watchdog (480s) < reclaim window (720s)
    //
    // Invert the last two and a tick has its work reclaimed and re-run
    // underneath it while it is still holding the claims — the duplicate send
    // this module exists to prevent.
    expect(TICK_WATCHDOG_MS).toBeGreaterThan(240_000);
    expect(TICK_WATCHDOG_MS).toBeLessThan(RECLAIM_AFTER_MS);
  });

  it("leaves room between the watchdog and the reclaim window", () => {
    // Back-to-back would mean the worker frees the guard at the same instant
    // the claims become reclaimable, with no margin for clock skew between
    // this process and whatever else is ticking.
    expect(RECLAIM_AFTER_MS - TICK_WATCHDOG_MS).toBeGreaterThanOrEqual(120_000);
  });

  it("does not touch a job whose run started recently", async () => {
    const { admin, updates } = db({
      jobs: [{ id: "j1", org_id: ORG, name: "Weekly report", running_run_id: "r1" }],
      run: { id: "r1", started_at: minsAgo(2) },
    });
    const r = await reclaimStalled(admin);
    expect(r.jobs).toBe(0);
    expect(updates).toHaveLength(0);
  });
});

describe("stranded work is released", () => {
  it("returns a long-stuck event to pending", async () => {
    const { admin, updates } = db({
      events: [
        { id: "e1", org_id: ORG, event_type: "NYLAS_NEW_MESSAGE", payload: {}, claimed_at: minsAgo(30) },
      ],
    });
    const r = await reclaimStalled(admin);
    expect(r.events).toBe(1);
    expect(updates[0].payload.status).toBe("pending");
    expect(updates[0].payload.claimed_at).toBeNull();
  });

  it("releases a job claim whose run is long finished or gone", async () => {
    const { admin } = db({
      jobs: [{ id: "j1", org_id: ORG, name: "Weekly report", running_run_id: "r1" }],
      run: { id: "r1", started_at: minsAgo(45) },
    });
    const r = await reclaimStalled(admin);
    expect(r.jobs).toBe(1);
  });

  it("treats a claim pointing at a missing run as stale by definition", async () => {
    // Nothing will ever clear it otherwise.
    const { admin } = db({
      jobs: [{ id: "j1", org_id: ORG, name: "Orphan", running_run_id: "gone" }],
      run: null,
    });
    expect((await reclaimStalled(admin)).jobs).toBe(1);
  });

  it("counts attempts on the event itself, so they survive the reclaim", async () => {
    const { admin, updates } = db({
      events: [
        { id: "e1", org_id: ORG, event_type: "X", payload: { _reclaims: 1 }, claimed_at: minsAgo(30) },
      ],
    });
    await reclaimStalled(admin);
    expect((updates[0].payload.payload as Record<string, unknown>)._reclaims).toBe(2);
  });
});

describe("repeated failure stops rather than loops", () => {
  it("abandons an event that keeps dying, and escalates it", async () => {
    const { admin, updates, inserts } = db({
      events: [
        {
          id: "e1",
          org_id: ORG,
          event_type: "NYLAS_NEW_MESSAGE",
          payload: { _reclaims: MAX_RECLAIMS },
          claimed_at: minsAgo(30),
        },
      ],
    });
    const r = await reclaimStalled(admin);

    expect(r.abandoned).toBe(1);
    expect(r.events).toBe(0);
    expect(updates[0].payload.status).toBe("failed");
    // A person has to find out. Silent abandonment is the failure mode.
    expect(inserts.some((i) => i.table === "escalations")).toBe(true);
  });

  it("disables a job that keeps crashing rather than retrying forever", async () => {
    const { admin, updates, inserts } = db({
      jobs: [{ id: "j1", org_id: ORG, name: "Weekly report", running_run_id: "r1" }],
      run: { id: "r1", started_at: minsAgo(45) },
      timedOutRuns: MAX_RECLAIMS,
    });
    const r = await reclaimStalled(admin);

    expect(r.abandoned).toBe(1);
    const disable = updates.find((u) => u.table === "agent_jobs" && u.payload.enabled === false);
    expect(disable).toBeTruthy();
    expect(inserts.some((i) => i.table === "escalations")).toBe(true);
  });

  it("caps at a small number — retrying a crash is not free", () => {
    expect(MAX_RECLAIMS).toBeGreaterThan(0);
    expect(MAX_RECLAIMS).toBeLessThanOrEqual(5);
  });
});

describe("it never takes the tick down", () => {
  it("survives a database failure and reports nothing reclaimed", async () => {
    const admin = {
      from() {
        throw new Error("connection reset");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const r = await reclaimStalled(admin);
    expect(r).toEqual({ jobs: 0, events: 0, abandoned: 0 });
  });
});
