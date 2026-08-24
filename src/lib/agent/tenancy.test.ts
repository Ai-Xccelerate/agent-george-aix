/**
 * Which organisation a shared credential may act for.
 *
 * On 2026-08-20 the cron sweeps iterated every row in `orgs` while holding one
 * deployment-wide Scribe token. That does not give each tenant its own data; it
 * copies one tenant's data into all of them — 1,230 transcripts and 1,016 tasks
 * across three organisations that had no business holding them.
 *
 * The rule is now: a shared credential acts for exactly one org, and if that org
 * cannot be identified UNAMBIGUOUSLY, nothing runs. Doing nothing beats acting
 * for the wrong tenant.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAILBOX_PROVIDER, georgeOrgIdFromEnv, resolveGeorgeOrgId } from "./tenancy";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

/** Serves connected-mailbox rows, or throws when asked to. */
function db(rows: Array<{ org_id: string }> | null, fail = false) {
  return {
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          fail
            ? reject(new Error("relation \"integrations\" does not exist"))
            : resolve({ data: rows, error: null }),
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const savedEnv = process.env.GEORGE_ORG_ID;

beforeEach(() => {
  delete process.env.GEORGE_ORG_ID;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.GEORGE_ORG_ID;
  else process.env.GEORGE_ORG_ID = savedEnv;
});

describe("data beats configuration", () => {
  it("uses the org that owns the mailbox integration", async () => {
    process.env.GEORGE_ORG_ID = ORG_B; // present, and deliberately not the answer
    const r = await resolveGeorgeOrgId(db([{ org_id: ORG_A }]));
    expect(r.orgId).toBe(ORG_A);
    expect(r.source).toBe("integration");
  });

  it("falls back to the env var while there is one shared grant", async () => {
    process.env.GEORGE_ORG_ID = ORG_A;
    const r = await resolveGeorgeOrgId(db([]));
    expect(r.orgId).toBe(ORG_A);
    expect(r.source).toBe("env");
  });

  it("exposes the env reader separately, for callers with no db handle", () => {
    process.env.GEORGE_ORG_ID = ORG_A;
    expect(georgeOrgIdFromEnv()).toBe(ORG_A);
  });
});

describe("it refuses to guess", () => {
  it("returns nothing when two mailboxes are connected", async () => {
    // Two connected mailboxes means the deployment is already multi-mailbox, so
    // any single answer is wrong for at least one tenant. This is the exact
    // shape of the fan-out that caused the incident.
    const r = await resolveGeorgeOrgId(db([{ org_id: ORG_A }, { org_id: ORG_B }]));
    expect(r.orgId).toBeNull();
    expect(r.source).toBe("ambiguous");
  });

  it("does not fall back to env when the answer is ambiguous", async () => {
    // Otherwise the env var silently picks a winner among real mailboxes.
    process.env.GEORGE_ORG_ID = ORG_A;
    const r = await resolveGeorgeOrgId(db([{ org_id: ORG_A }, { org_id: ORG_B }]));
    expect(r.orgId).toBeNull();
  });

  it("returns nothing when there is no row and no env var", async () => {
    const r = await resolveGeorgeOrgId(db([]));
    expect(r.orgId).toBeNull();
    expect(r.source).toBe("none");
  });
});

describe("it survives a broken lookup", () => {
  it("falls back to env rather than throwing inside a cron tick", async () => {
    process.env.GEORGE_ORG_ID = ORG_A;
    const r = await resolveGeorgeOrgId(db(null, true));
    expect(r.orgId).toBe(ORG_A);
    expect(r.source).toBe("env");
  });

  it("still returns nothing when there is no env fallback either", async () => {
    const r = await resolveGeorgeOrgId(db(null, true));
    expect(r.orgId).toBeNull();
  });
});

describe("the provider key", () => {
  it("is a value the integration_provider enum actually accepts", () => {
    // It was "george_mailbox", which the enum does not have. Every lookup
    // raised, the catch swallowed it, and the resolver fell back to the env
    // var — working by accident, and guaranteed to never find a real row.
    const enumValues = [
      "composio", "m365", "fireflies", "onedrive", "zoho",
      "gmail", "slack", "custom", "parchment", "nylas", "scribe",
    ];
    expect(enumValues).toContain(MAILBOX_PROVIDER);
  });

  it("is stable — renaming it detaches every existing row from the resolver", () => {
    expect(MAILBOX_PROVIDER).toBe("nylas");
  });
});
