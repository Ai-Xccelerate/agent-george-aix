/**
 * The domain allowlist state machine.
 *
 * WHY THIS NEEDED A TEST BEFORE IT COULD BE CALLED CONFIRMED
 * This is the guard that decides who George is allowed to email. It had four
 * server actions, a documented one-way-door bug that was fixed by adding a
 * fifth transition, and no test at any level — so "approval and re-approval
 * work end to end" was a claim resting on reading the code. AGENTS.md is blunt
 * about that shape: a verification that cannot report failure is not a
 * verification.
 *
 * WHAT IS ACTUALLY ASSERTED
 * The `status` filter on each update, not just the resulting row. Every double
 * here would happily answer any `.eq()` the same way, so a test that only
 * checked "it returned ok" would pass whether re-approval moved a row from
 * `rejected`, from `pending`, or from anything at all. Recording the filters is
 * what lets the test disagree with the query rather than agree with it.
 *
 * The transitions that must hold:
 *   pending  → approved / rejected   decideDomainAction, approver only
 *   approved → rejected              revokeDomainAction
 *   rejected → approved              reapproveDomainAction
 *   pending  ↛ approved via reapprove  (would skip the decision)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const APPROVER = {
  user: { id: "user-1", orgId: "org-1", role: "admin" },
};
let gate: typeof APPROVER | { error: string } = APPROVER;
vi.mock("@/lib/actions", async (orig) => ({
  ...(await orig<typeof import("@/lib/actions")>()),
  requireApprover: async () => gate,
}));

type Filter = { col: string; value: unknown };

/** The update that was attempted: its payload and the filters guarding it. */
let lastUpdate: { payload: Record<string, unknown>; filters: Filter[] } | null = null;
let lastInsert: Record<string, unknown> | null = null;
/** What the update matched. null models "no row was in that state". */
let updateResult: { domain: string } | null = { domain: "acmecorp.com" };
let insertError: { message: string } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => ({
    from: () => {
      const filters: Filter[] = [];
      const chain: Record<string, unknown> = {
        insert: (payload: Record<string, unknown>) => {
          lastInsert = payload;
          return { error: insertError };
        },
        update: (payload: Record<string, unknown>) => {
          lastUpdate = { payload, filters };
          return chain;
        },
        eq: (col: string, value: unknown) => {
          filters.push({ col, value });
          return chain;
        },
        select: () => chain,
        maybeSingle: async () => ({ data: updateResult, error: null }),
        // revoke/reapprove do not .select(); they are awaited on the builder.
        then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
      };
      return chain;
    },
  }),
}));

const {
  decideDomainAction,
  proposeDomainAction,
  reapproveDomainAction,
  revokeDomainAction,
} = await import("./actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

// Read through functions, not the variable: assigning `lastUpdate = null` in a
// loop narrows its type to `never` for the rest of the block, and TS then
// rejects the assertion that follows the call.
const statusFilter = () =>
  lastUpdate?.filters.find((f) => f.col === "status")?.value ?? null;
const updateFilters = () => lastUpdate?.filters ?? null;

beforeEach(() => {
  gate = APPROVER;
  lastUpdate = null;
  lastInsert = null;
  updateResult = { domain: "acmecorp.com" };
  insertError = null;
});

describe("proposing a domain", () => {
  it("normalises a pasted URL down to the bare domain", async () => {
    // People paste what is in the address bar. Storing "https://acmecorp.com/"
    // would never match a recipient's domain, so the guard would silently fail
    // open-looking and closed-behaving.
    const res = await proposeDomainAction({}, form({ domain: "HTTPS://AcmeCorp.com/pricing" }));
    expect(res.error).toBeUndefined();
    expect(lastInsert?.domain).toBe("acmecorp.com");
    expect(lastInsert?.status).toBeUndefined(); // defaults to pending in the DB
  });

  it("rejects something that is an address rather than a domain", async () => {
    const res = await proposeDomainAction({}, form({ domain: "someone@acmecorp.com" }));
    expect(res.error).toMatch(/valid domain/i);
    expect(lastInsert).toBeNull();
  });

  it("refuses a domain that is already internal", async () => {
    const res = await proposeDomainAction({}, form({ domain: "aixccelerate.com" }));
    expect(res.error).toMatch(/already internal/i);
    expect(lastInsert).toBeNull();
  });
});

describe("deciding a pending domain", () => {
  it("approves only from pending", async () => {
    const res = await decideDomainAction(
      {},
      form({ domain_id: "d1", decision: "approved" }),
    );
    expect(res.info).toMatch(/approved/i);
    expect(lastUpdate?.payload.status).toBe("approved");
    // The transition guard. Without it, approve could re-approve a revoked
    // domain without a fresh decision.
    expect(statusFilter()).toBe("pending");
  });

  it("rejects only from pending", async () => {
    await decideDomainAction({}, form({ domain_id: "d1", decision: "rejected" }));
    expect(lastUpdate?.payload.status).toBe("rejected");
    expect(statusFilter()).toBe("pending");
  });

  it("reports honestly when the row is no longer pending", async () => {
    updateResult = null; // nothing matched
    const res = await decideDomainAction(
      {},
      form({ domain_id: "d1", decision: "approved" }),
    );
    expect(res.error).toMatch(/isn't pending/i);
    expect(res.info).toBeUndefined();
  });

  it("refuses an unknown decision", async () => {
    const res = await decideDomainAction({}, form({ domain_id: "d1", decision: "maybe" }));
    expect(res.error).toMatch(/unknown decision/i);
    expect(lastUpdate).toBeNull();
  });

  it("is approver-gated", async () => {
    gate = { error: "Approvers only." };
    const res = await decideDomainAction(
      {},
      form({ domain_id: "d1", decision: "approved" }),
    );
    expect(res.error).toBe("Approvers only.");
    expect(lastUpdate).toBeNull();
  });
});

describe("revoking and re-approving", () => {
  it("revokes only from approved", async () => {
    await revokeDomainAction(form({ domain_id: "d1" }));
    expect(lastUpdate?.payload.status).toBe("rejected");
    expect(statusFilter()).toBe("approved");
    expect(lastUpdate?.payload.decision_note).toMatch(/revoked/i);
  });

  it("re-approves from rejected, and records that it came back", async () => {
    // The bug this transition exists to fix: revoke wrote `rejected`, and
    // nothing moved a row out of `rejected`, so revoke was a one-way door and
    // the domain vanished from the page entirely.
    await reapproveDomainAction(form({ domain_id: "d1" }));
    expect(lastUpdate?.payload.status).toBe("approved");
    expect(statusFilter()).toBe("rejected");
    expect(lastUpdate?.payload.decision_note).toMatch(/re-approved/i);
  });

  it("cannot use re-approve to skip a pending decision", async () => {
    // The filter is the whole control. If it ever widened to include pending,
    // proposing a domain and immediately "re-approving" it would bypass review.
    await reapproveDomainAction(form({ domain_id: "d1" }));
    expect(statusFilter()).not.toBe("pending");
  });

  it("scopes every write to the caller's org", async () => {
    // A domain id from another tenant must not be decidable. Cheap to assert,
    // and the audit that found two missing org filters elsewhere is why.
    for (const run of [
      () => revokeDomainAction(form({ domain_id: "d1" })),
      () => reapproveDomainAction(form({ domain_id: "d1" })),
      () => decideDomainAction({}, form({ domain_id: "d1", decision: "approved" })),
    ]) {
      lastUpdate = null;
      await run();
      expect(updateFilters()).toEqual(
        expect.arrayContaining([{ col: "org_id", value: "org-1" }]),
      );
    }
  });

  it("does nothing at all for a non-approver", async () => {
    gate = { error: "Approvers only." };
    await revokeDomainAction(form({ domain_id: "d1" }));
    await reapproveDomainAction(form({ domain_id: "d1" }));
    expect(lastUpdate).toBeNull();
  });

  it("ignores a call with no domain id", async () => {
    await reapproveDomainAction(form({}));
    expect(lastUpdate).toBeNull();
  });
});
