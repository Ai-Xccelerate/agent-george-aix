/**
 * Who may wake George.
 *
 * This gate decides whether an inbound email starts an autonomous agent run, and
 * until now it had no tests — the existing file covers extractDomain, a pure
 * string helper, and stops there.
 *
 * It also used to hold this:
 *
 *     const ORG_DOMAINS = new Set(["getonyx.ai", "aixccelerate.com"]);
 *
 * Two different companies' domains, in the function that starts agent runs. A
 * third organisation could never be reached at all, and for either of those two,
 * the OTHER company's staff could wake their agent — across a tenant boundary.
 *
 * The first test below is that one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = "11111111-1111-1111-1111-111111111111";

/** The real columns on `contacts`. No org_id — it is scoped via customer_id. */
const CONTACT_COLUMNS = new Set([
  "id",
  "customer_id",
  "full_name",
  "title",
  "email",
  "phone",
  "is_primary",
  "timezone",
  "notes",
  "role",
  // The join alias the query filters through.
  "customers.org_id",
]);

let orgDomain: string | null = "acmecorp.com";
let knownContacts: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (_c: string, v: string) => {
          // The double refuses columns the real table does not have.
          //
          // It used to accept anything, which is how a filter on
          // contacts.org_id — a column that does not exist — passed every
          // test in this file while failing for every real sender. A mock
          // more permissive than the database does not test the query, it
          // just agrees with it.
          if (table === "contacts" && !CONTACT_COLUMNS.has(_c)) {
            throw new Error(`column "${_c}" does not exist`);
          }
          if (table === "contacts" && _c === "email") {
            (chain as Record<string, unknown>).__email = v;
          }
          return chain;
        },
        maybeSingle: async () => {
          if (table === "orgs") return { data: { domain: orgDomain }, error: null };
          if (table === "contacts") {
            const email = (chain as Record<string, unknown>).__email as string;
            return { data: knownContacts.includes(email) ? { id: "c1" } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  }),
}));

const { isSenderAllowed } = await import("./sender-allowlist");
const { clearOrgIdentityCache } = await import("./identity");

const savedDomains = process.env.GEORGE_INTERNAL_DOMAINS;
const savedEmail = process.env.GEORGE_EMAIL;

beforeEach(() => {
  clearOrgIdentityCache();
  delete process.env.GEORGE_INTERNAL_DOMAINS;
  delete process.env.GEORGE_EMAIL;
  orgDomain = "acmecorp.com";
  knownContacts = [];
});

afterEach(() => {
  clearOrgIdentityCache();
  if (savedDomains === undefined) delete process.env.GEORGE_INTERNAL_DOMAINS;
  else process.env.GEORGE_INTERNAL_DOMAINS = savedDomains;
  if (savedEmail === undefined) delete process.env.GEORGE_EMAIL;
  else process.env.GEORGE_EMAIL = savedEmail;
});

describe("the org's own people can wake George", () => {
  it("allows a sender at the organisation's own domain", async () => {
    const d = await isSenderAllowed(ORG_A, "someone@acmecorp.com");
    expect(d.allowed).toBe(true);
    expect(d.allowed && d.reason).toBe("org-domain");
  });

  it("does NOT allow another tenant's domain", async () => {
    // The hardcoded pair meant one company's staff could wake another
    // company's agent. This is that test.
    const d = await isSenderAllowed(ORG_A, "rahul@aixccelerate.com");
    expect(d.allowed).toBe(false);
  });

  it("does not treat the previously hardcoded domains as special", async () => {
    for (const addr of ["a@getonyx.ai", "b@aixccelerate.com"]) {
      const d = await isSenderAllowed(ORG_A, addr);
      expect(d.allowed, `${addr} should not be privileged`).toBe(false);
    }
  });

  it("is case-insensitive and tolerates display-name wrapping", async () => {
    const d = await isSenderAllowed(ORG_A, "Someone <Someone@AcmeCorp.COM>");
    expect(d.allowed).toBe(true);
  });
});

describe("known contacts can wake George", () => {
  it("allows an address recorded in contacts, whatever its domain", async () => {
    knownContacts = ["buyer@customer.example"];
    const d = await isSenderAllowed(ORG_A, "buyer@customer.example");
    expect(d.allowed).toBe(true);
    expect(d.allowed && d.reason).toBe("known-contact");
  });

  it("still rejects a stranger at the same domain as a known contact", async () => {
    knownContacts = ["buyer@customer.example"];
    const d = await isSenderAllowed(ORG_A, "someone-else@customer.example");
    expect(d.allowed).toBe(false);
  });
});

describe("it fails closed", () => {
  it("rejects an unknown sender", async () => {
    const d = await isSenderAllowed(ORG_A, "stranger@nowhere.example");
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.reason).toBe("domain-not-allowlisted");
  });

  it("rejects a missing or malformed sender", async () => {
    for (const bad of [null, undefined, "", "not-an-address"]) {
      const d = await isSenderAllowed(ORG_A, bad as string | null);
      expect(d.allowed).toBe(false);
    }
  });

  it("accepts only known contacts when the org has no domain configured", async () => {
    // A real trade: silence is recoverable, a stranger starting an agent run is
    // not. An org that has not said who it is gets the stricter reading.
    orgDomain = null;
    knownContacts = ["buyer@customer.example"];

    expect((await isSenderAllowed(ORG_A, "anyone@anywhere.example")).allowed).toBe(false);
    expect((await isSenderAllowed(ORG_A, "buyer@customer.example")).allowed).toBe(true);
  });
});

describe("a customer replying is the case this exists for", () => {
  it("admits a known contact scoped through their customer", async () => {
    // The known-contact branch filtered on contacts.org_id, which does not
    // exist. Postgres rejected the query, the error became a null, and the
    // branch answered "not a known contact" for everyone — so the only senders
    // who could ever wake George were people on the org's own domain.
    //
    // Colleagues emailing George is the incidental case. A customer replying is
    // the entire feature, and it was the one thing this could not admit.
    knownContacts = ["buyer@customer.example"];
    const d = await isSenderAllowed(ORG_A, "buyer@customer.example");
    expect(d.allowed).toBe(true);
    expect(d.allowed && d.reason).toBe("known-contact");
  });

  it("does not filter contacts on a column the table does not have", async () => {
    // The mock throws on an unknown contacts column, so a regression here fails
    // loudly rather than silently rejecting every customer.
    knownContacts = ["buyer@customer.example"];
    await expect(isSenderAllowed(ORG_A, "buyer@customer.example")).resolves.toMatchObject({
      allowed: true,
    });
  });
});
