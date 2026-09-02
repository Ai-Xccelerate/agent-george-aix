/**
 * Preconditions, and the recipient rule they enforce.
 *
 * The recipient half is the direct descendant of 2026-08-20: the instruction
 * named no recipient, so the agent assembled a list from message content. The
 * fix is structural — a contact is only a candidate if somebody explicitly said
 * who they are on the account.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { checkOnboardingPreconditions, pickRecipient } from "./onboarding-preconditions";
import { clearTenantProcessCache } from "./tenant-process";

// resolveTenantProcess caches for 60s, so without this a test that supplies no
// process still sees the one an earlier test resolved.
beforeEach(() => clearTenantProcessCache());

const ORG = "org-1";
const CUST = "cust-1";

function db(opts: {
  customer?: { id: string; name: string } | null;
  contacts?: Array<{ id: string; full_name: string | null; email: string | null; role: string | null }>;
  contracts?: unknown[];
  running?: unknown[];
  process?: Record<string, unknown> | null;
}) {
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        limit: async () => ({
          data:
            table === "contracts"
              ? (opts.contracts ?? [{ id: "k1", signed_at: "2026-01-01" }])
              : table === "onboarding_touchpoint"
                ? (opts.running ?? [])
                : [],
          error: null,
        }),
        maybeSingle: async () => ({
          data:
            table === "customers"
              ? opts.customer === undefined
                ? { id: CUST, name: "Northwind" }
                : opts.customer
              : table === "tenant_process"
                ? opts.process === undefined
                  ? {
                      id: "p1",
                      org_id: ORG,
                      type: "onboarding",
                      objective: "Go",
                      stages: [{ key: "s", name: "S", description: "d" }],
                      touchpoints: [{ key: "t", day_offset: 0, purpose: "p", ask: "a" }],
                      escalation: {},
                      voice: null,
                      first_value: { configured: true },
                    }
                  : opts.process
                : null,
          error: null,
        }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: (opts.contacts ?? []) as unknown[], error: null }),
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return admin;
}

const CHAMPION = { id: "c1", full_name: "Dana Rowe", email: "dana@acme.example", role: "champion" };

describe("the recipient is chosen by role, never by position", () => {
  it("prefers the champion over an earlier-listed contact", () => {
    const picked = pickRecipient([
      { id: "c0", full_name: "Random First", email: "first@acme.example", role: "end_user" },
      CHAMPION,
    ]);
    expect(picked?.id).toBe("c1");
  });

  it("ignores a contact with no role, however primary-looking", () => {
    // The customer page does `find(is_primary) ?? contacts[0]`. That is fine for
    // showing a name and wrong for deciding who gets mail.
    const picked = pickRecipient([
      { id: "c0", full_name: "Chief Person", email: "chief@acme.example", role: null },
    ]);
    expect(picked).toBeNull();
  });

  it("ignores a role with no email", () => {
    expect(
      pickRecipient([{ id: "c0", full_name: "No Mail", email: null, role: "champion" }]),
    ).toBeNull();
  });

  it("sorts an unrecognised role last rather than first", () => {
    // A role we do not recognise is not evidence that this is the right person.
    const picked = pickRecipient([
      { id: "c0", full_name: "Odd", email: "odd@acme.example", role: "wildcard" },
      { id: "c1", full_name: "Billing", email: "bill@acme.example", role: "billing" },
    ]);
    expect(picked?.id).toBe("c1");
  });

  it("returns nothing rather than guessing when the list is empty", () => {
    expect(pickRecipient([])).toBeNull();
  });
});

describe("refusals name what is missing", () => {
  it("passes when everything is in place", async () => {
    const r = await checkOnboardingPreconditions(db({ contacts: [CHAMPION] }), ORG, CUST);
    expect(r.ok).toBe(true);
    expect(r.ok && r.recipient.email).toBe("dana@acme.example");
    expect(r.ok && r.recipient.role).toBe("champion");
  });

  it("distinguishes no contacts from contacts without roles", async () => {
    const none = await checkOnboardingPreconditions(db({ contacts: [] }), ORG, CUST);
    expect(!none.ok && none.failures[0].reason).toContain("no contacts yet");

    const unroled = await checkOnboardingPreconditions(
      db({ contacts: [{ id: "c0", full_name: "X", email: "x@acme.example", role: null }] }),
      ORG,
      CUST,
    );
    expect(!unroled.ok && unroled.failures[0].reason).toContain("none with both an email address and a role");
  });

  it("says why the contract matters rather than just that it is absent", async () => {
    const r = await checkOnboardingPreconditions(db({ contacts: [CHAMPION], contracts: [] }), ORG, CUST);
    expect(!r.ok && r.failures.some((f) => f.code === "no_contract")).toBe(true);
    expect(!r.ok && r.failures.find((f) => f.code === "no_contract")!.reason).toContain("no day one");
  });

  it("refuses when the tenant has no usable process, and points at settings", async () => {
    const r = await checkOnboardingPreconditions(
      db({ contacts: [CHAMPION], process: null }),
      ORG,
      CUST,
    );
    const f = !r.ok ? r.failures.find((x) => x.code === "no_process") : undefined;
    expect(f).toBeTruthy();
    expect(f!.fix?.href).toBe("/settings/agent");
  });

  it("refuses a second draft while one is still awaiting review", async () => {
    const r = await checkOnboardingPreconditions(
      db({ contacts: [CHAMPION], running: [{ id: "t1" }] }),
      ORG,
      CUST,
    );
    expect(!r.ok && r.failures.some((f) => f.code === "already_running")).toBe(true);
  });

  it("reports every missing thing at once, not one at a time", async () => {
    // Fixing one, being told about the next, fixing that, being told about the
    // third is a bad way to spend somebody's afternoon.
    const r = await checkOnboardingPreconditions(
      db({ contacts: [], contracts: [], process: null }),
      ORG,
      CUST,
    );
    expect(!r.ok && r.failures.map((f) => f.code).sort()).toEqual([
      "no_contact_with_role",
      "no_contract",
      "no_process",
    ]);
  });

  it("stops at a missing customer rather than reporting five faults about nothing", async () => {
    const r = await checkOnboardingPreconditions(db({ customer: null }), ORG, CUST);
    expect(!r.ok && r.failures).toHaveLength(1);
    expect(!r.ok && r.failures[0].code).toBe("customer_not_found");
  });
});
