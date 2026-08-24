/**
 * Who counts as "internal" decides whether George may send without asking, so
 * this is a security boundary, not a formatting detail.
 *
 * It used to be a module-level constant built from environment variables at
 * import time — one answer for the whole deployment. With a second organisation
 * on the same deployment, George would have been told the FIRST org's domain was
 * internal while judging the second org's mail, and a stranger would have been
 * treated as a colleague on the exact code path that permits sending.
 *
 * The tests that matter most are the fail-closed ones: an org with no domain
 * must have NO internal domains, and a lookup failure must not widen the set.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOrgIdentityCache,
  internalDescription,
  isInternalTo,
  resolveOrgIdentity,
} from "./identity";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

/** Serves a per-org `orgs.domain`, or throws when asked to. */
function db(domains: Record<string, string | null>, fail = false) {
  return {
    from() {
      let orgId = "";
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (_col: string, value: string) => {
          orgId = value;
          return chain;
        },
        maybeSingle: async () => {
          if (fail) throw new Error("connection reset");
          return { data: { domain: domains[orgId] ?? null }, error: null };
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const saved = {
  email: process.env.GEORGE_EMAIL,
  nylas: process.env.NYLAS_FROM_EMAIL,
  domains: process.env.GEORGE_INTERNAL_DOMAINS,
};

beforeEach(() => {
  clearOrgIdentityCache();
  delete process.env.GEORGE_EMAIL;
  delete process.env.NYLAS_FROM_EMAIL;
  delete process.env.GEORGE_INTERNAL_DOMAINS;
});

afterEach(() => {
  clearOrgIdentityCache();
  for (const [k, v] of [
    ["GEORGE_EMAIL", saved.email],
    ["NYLAS_FROM_EMAIL", saved.nylas],
    ["GEORGE_INTERNAL_DOMAINS", saved.domains],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("internal-ness is per organisation", () => {
  it("does not treat one tenant's domain as internal to another", async () => {
    // The whole point. Two orgs, two domains, one deployment.
    const store = db({ [ORG_A]: "aixccelerate.com", [ORG_B]: "acmecorp.com" });

    const a = await resolveOrgIdentity(store, ORG_A);
    const b = await resolveOrgIdentity(store, ORG_B);

    expect(isInternalTo(a, "rahul@aixccelerate.com")).toBe(true);
    expect(isInternalTo(a, "someone@acmecorp.com")).toBe(false);

    expect(isInternalTo(b, "someone@acmecorp.com")).toBe(true);
    expect(isInternalTo(b, "rahul@aixccelerate.com")).toBe(false);
  });

  it("caches per org, not globally", async () => {
    const store = db({ [ORG_A]: "aixccelerate.com", [ORG_B]: "acmecorp.com" });
    await resolveOrgIdentity(store, ORG_A);
    const b = await resolveOrgIdentity(store, ORG_B);
    // A shared cache entry would hand org B org A's domain.
    expect(isInternalTo(b, "rahul@aixccelerate.com")).toBe(false);
  });
});

describe("it fails closed", () => {
  it("gives an org with no domain NO internal domains", async () => {
    // Every recipient external means every send needs approval. The opposite
    // failure — deciding a stranger is a colleague — is the dangerous one.
    const identity = await resolveOrgIdentity(db({ [ORG_A]: null }), ORG_A);
    expect(identity.internalDomains.size).toBe(0);
    expect(isInternalTo(identity, "anyone@anywhere.com")).toBe(false);
  });

  it("does not widen the set when the lookup throws", async () => {
    const identity = await resolveOrgIdentity(db({}, true), ORG_A);
    expect(isInternalTo(identity, "rahul@aixccelerate.com")).toBe(false);
  });

  it("never resolves an address by default", async () => {
    // GEORGE_ADDRESS used to fall back to a real colleague's mailbox, so an
    // unset variable made George advertise a person's address to customers.
    const identity = await resolveOrgIdentity(db({ [ORG_A]: "acmecorp.com" }), ORG_A);
    expect(identity.address).toBe("");
  });
});

describe("resolution details", () => {
  it("counts George's own mailbox domain as internal", async () => {
    // Otherwise a reply-all that includes George reads as "external present"
    // and the send is refused.
    process.env.GEORGE_EMAIL = "george@aiwkr.com";
    const identity = await resolveOrgIdentity(db({ [ORG_A]: "acmecorp.com" }), ORG_A);
    expect(isInternalTo(identity, "george@aiwkr.com")).toBe(true);
    expect(isInternalTo(identity, "someone@acmecorp.com")).toBe(true);
  });

  it("falls back to the Nylas sending address when GEORGE_EMAIL is unset", async () => {
    process.env.NYLAS_FROM_EMAIL = "george@aiwkr.com";
    const identity = await resolveOrgIdentity(db({ [ORG_A]: null }), ORG_A);
    expect(identity.address).toBe("george@aiwkr.com");
  });

  it("normalises a domain stored with a scheme or www", async () => {
    const identity = await resolveOrgIdentity(db({ [ORG_A]: "https://www.AcmeCorp.com/" }), ORG_A);
    expect(isInternalTo(identity, "buyer@acmecorp.com")).toBe(true);
  });

  it("is case-insensitive about the address", async () => {
    const identity = await resolveOrgIdentity(db({ [ORG_A]: "acmecorp.com" }), ORG_A);
    expect(isInternalTo(identity, "Buyer@AcmeCorp.COM")).toBe(true);
  });

  it("handles a malformed address without throwing", async () => {
    const identity = await resolveOrgIdentity(db({ [ORG_A]: "acmecorp.com" }), ORG_A);
    expect(isInternalTo(identity, "not-an-address")).toBe(false);
    expect(isInternalTo(identity, null)).toBe(false);
    expect(isInternalTo(identity, "")).toBe(false);
  });

  it("still honours an explicit deployment-wide list", async () => {
    process.env.GEORGE_INTERNAL_DOMAINS = "contractor.example, partner.example";
    const identity = await resolveOrgIdentity(db({ [ORG_A]: "acmecorp.com" }), ORG_A);
    expect(isInternalTo(identity, "a@contractor.example")).toBe(true);
    expect(isInternalTo(identity, "b@partner.example")).toBe(true);
  });
});

describe("describing internal-ness to the model", () => {
  it("names the org's own domains, not a hardcoded one", async () => {
    const identity = await resolveOrgIdentity(db({ [ORG_A]: "acmecorp.com" }), ORG_A);
    expect(internalDescription(identity)).toBe("@acmecorp.com");
  });

  it("says so plainly when nothing is configured", async () => {
    // The prompt must not assert a domain it does not have.
    const identity = await resolveOrgIdentity(db({ [ORG_A]: null }), ORG_A);
    expect(internalDescription(identity)).toContain("none configured");
  });
});
