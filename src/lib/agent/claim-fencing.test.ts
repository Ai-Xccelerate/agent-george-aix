/**
 * The claim fence: a process that lost its event must not write over the winner.
 *
 * The claim that starts event processing was always safe. It is conditional on
 * status='pending', so two processes cannot both win a pending row.
 *
 * The unsafe moment is later, and it is the one observed on 2026-08-27 when a
 * worker deploy ran two containers concurrently:
 *
 *   1. worker A claims event E and starts work
 *   2. A hangs past the 12-minute reclaim window
 *   3. reclaim.ts releases E back to 'pending' — correctly; A looks dead
 *   4. worker B claims E and processes it
 *   5. A wakes up and writes its own terminal status over B's
 *
 * Nobody did anything wrong, and afterwards the row is indistinguishable from
 * an event processed exactly once. These tests are about step 5 being refused
 * and said out loud instead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** A fake agent_events table that enforces the WHERE clause the fence relies on. */
function eventsTable(initial: { id: string; claim_id: string | null; status: string }) {
  const row = { ...initial };
  const writes: Array<Record<string, unknown>> = [];

  const admin = {
    from() {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        update(p: Record<string, unknown>) {
          patch = p;
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        select: async () => {
          // The database only applies the write if every filter matches.
          const matches = Object.entries(filters).every(
            ([k, v]) => (row as Record<string, unknown>)[k] === v,
          );
          if (!matches) return { data: [], error: null };
          Object.assign(row, patch);
          writes.push(patch);
          return { data: [{ id: row.id }], error: null };
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { admin, row, writes };
}

/**
 * settleEvent is module-private, so this mirrors it exactly. If the real one
 * changes shape, the import-level tests in process-event will catch it; what is
 * being pinned here is the BEHAVIOUR the column exists to provide.
 */
async function settleEvent(
  admin: ReturnType<typeof eventsTable>["admin"],
  event: { id: string; claim_id: string | null; event_type?: string },
  patch: Record<string, unknown>,
): Promise<boolean> {
  let q = admin.from().update({ ...patch, claim_id: null }).eq("id", event.id);
  if (event.claim_id) q = q.eq("claim_id", event.claim_id);
  const res = await q.select("id");
  if (res.error) return false;
  if (event.claim_id && (res.data ?? []).length === 0) {
    console.error("[process-event] LOST CLAIM", { id: event.id, our_claim: event.claim_id });
    return false;
  }
  return true;
}

afterEach(() => vi.restoreAllMocks());

describe("a process that still holds its claim can settle the event", () => {
  it("writes the terminal status", async () => {
    const { admin, row } = eventsTable({ id: "e1", claim_id: "claim-A", status: "processing" });
    const ok = await settleEvent(admin, { id: "e1", claim_id: "claim-A" }, { status: "processed" });

    expect(ok).toBe(true);
    expect(row.status).toBe("processed");
  });

  it("releases the claim as part of settling — a finished row holds nothing", async () => {
    const { admin, row } = eventsTable({ id: "e1", claim_id: "claim-A", status: "processing" });
    await settleEvent(admin, { id: "e1", claim_id: "claim-A" }, { status: "processed" });

    expect(row.claim_id).toBeNull();
  });
});

describe("a process that lost its claim is refused", () => {
  it("does not overwrite the result of the process that took over", async () => {
    // Worker B has already claimed and finished it.
    const { admin, row } = eventsTable({ id: "e1", claim_id: "claim-B", status: "processed" });
    row.status = "processed";

    // Worker A wakes up holding the stale claim and tries to write 'failed'.
    const ok = await settleEvent(admin, { id: "e1", claim_id: "claim-A" }, { status: "failed" });

    expect(ok).toBe(false);
    expect(row.status).toBe("processed"); // B's result survives
    expect(row.claim_id).toBe("claim-B"); // and B still holds it
  });

  it("says so at error level, naming the claim, so it can be matched to the reclaim", async () => {
    // Silent divergence is the failure mode: if sending were on, the customer
    // already has two emails and nothing else in the system would show it.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = eventsTable({ id: "e1", claim_id: "claim-B", status: "processed" });

    await settleEvent(admin, { id: "e1", claim_id: "claim-A" }, { status: "failed" });

    expect(spy).toHaveBeenCalled();
    const [msg, detail] = spy.mock.calls[0];
    expect(String(msg)).toContain("LOST CLAIM");
    expect(detail).toMatchObject({ our_claim: "claim-A" });
  });

  it("is refused even when the row was released and not yet re-claimed", async () => {
    // reclaim.ts set claim_id back to null. A's stale claim still matches
    // nothing, which is what stops it resurrecting a pending event as done.
    const { admin, row } = eventsTable({ id: "e1", claim_id: null, status: "pending" });
    const ok = await settleEvent(admin, { id: "e1", claim_id: "claim-A" }, { status: "processed" });

    expect(ok).toBe(false);
    expect(row.status).toBe("pending");
  });
});

describe("rows predating the migration still settle", () => {
  it("updates unguarded when the event carries no claim id", async () => {
    // Migration 0003 is additive and nullable, so events claimed by the old
    // code have claim_id = null. Fencing those would strand them permanently.
    const { admin, row } = eventsTable({ id: "old", claim_id: null, status: "processing" });
    const ok = await settleEvent(admin, { id: "old", claim_id: null }, { status: "processed" });

    expect(ok).toBe(true);
    expect(row.status).toBe("processed");
  });
});
