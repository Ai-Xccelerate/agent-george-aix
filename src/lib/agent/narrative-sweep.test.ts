/**
 * The step that was missing.
 *
 * `write_account_narrative` was built, registered, reachable and never called.
 * `customer_narrative` had zero rows and the headline section of every account
 * page rendered empty — and nothing failed, which is why it survived. Every
 * test of the tool itself passed; there was no test that anything invoked it.
 *
 * So these assert the selection and the framing, and cron-tick.ts surfaces the
 * count in its result so a tick that quietly writes none is visible rather than
 * merely quiet.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildNarrativePrompt, findCandidates } from "./narrative-sweep";

type Row = Record<string, unknown>;

let customers: Row[] = [];
let narrativeByCustomer: Record<string, string | null> = {};
let obsCount = 0;
let transcriptCount = 0;

/** Enough of the client for candidate selection: a list, a date, two counts. */
function db() {
  return {
    from(table: string) {
      let customerId = "";
      const chain: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean; count?: string }) => {
          if (o?.head || o?.count) {
            return {
              eq: (_col: string, v: string) => {
                customerId = v;
                return {
                  gt: async () => ({
                    count: table === "customer_observations" ? obsCount : transcriptCount,
                    error: null,
                  }),
                };
              },
            };
          }
          return chain;
        },
        eq: (_col: string, v: string) => {
          customerId = v;
          return chain;
        },
        is: () => chain,
        in: () => chain,
        gt: async () => ({ count: 0, error: null }),
        order: () => chain,
        limit: async () => {
          if (table === "customers") return { data: customers, error: null };
          if (table === "customer_narrative") {
            const at = narrativeByCustomer[customerId];
            return { data: at ? [{ written_at: at }] : [], error: null };
          }
          return { data: [], error: null };
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const acct = (id: string, name: string): Row => ({ id, org_id: "org-1", name });

beforeEach(() => {
  customers = [acct("c1", "Onyx")];
  narrativeByCustomer = {};
  obsCount = 0;
  transcriptCount = 0;
});

describe("who is due a narrative", () => {
  it("picks an account that has never had one, however thin the evidence", async () => {
    // The zero-rows case this whole file exists for. An account with nothing
    // written gets one regardless — George is told to say when evidence is
    // thin, and "quiet since signup" is worth reading on the page.
    const rows = await findCandidates(db());
    expect(rows).toHaveLength(1);
    expect(rows[0].has_narrative).toBe(false);
  });

  it("leaves an account alone when nothing has happened since", async () => {
    // Rewriting an unchanged account spends a model call to produce the same
    // paragraph with a newer timestamp.
    narrativeByCustomer.c1 = "2026-09-01T00:00:00Z";
    obsCount = 0;
    transcriptCount = 0;
    expect(await findCandidates(db())).toHaveLength(0);
  });

  it("picks it up again once new evidence lands", async () => {
    narrativeByCustomer.c1 = "2026-09-01T00:00:00Z";
    obsCount = 3;
    const rows = await findCandidates(db());
    expect(rows).toHaveLength(1);
    expect(rows[0].new_observations).toBe(3);
  });

  it("puts never-written accounts ahead of stale ones", async () => {
    // An empty headline section is worse to look at than a slightly old one.
    customers = [acct("c1", "Has one"), acct("c2", "Has none")];
    narrativeByCustomer = { c1: "2026-09-01T00:00:00Z", c2: null };
    obsCount = 9;
    transcriptCount = 9;

    const rows = await findCandidates(db());
    expect(rows[0].name).toBe("Has none");
  });
});

describe("what George is asked", () => {
  const base = {
    customer_id: "c1",
    name: "Onyx",
    new_observations: 4,
    new_transcripts: 2,
    has_narrative: true,
  };

  it("tells him to replace rather than extend", async () => {
    // The tool replaces; the prompt has to agree, or he writes an addendum.
    const p = buildNarrativePrompt(base);
    expect(p).toMatch(/replace it/i);
    expect(p).toMatch(/not what has changed since last time/i);
  });

  it("says it is the first one when there is no narrative", () => {
    const p = buildNarrativePrompt({ ...base, has_narrative: false });
    expect(p).toMatch(/no narrative yet/i);
    expect(p).not.toMatch(/replace it/i);
  });

  it("requires him to read the account, not just its name and lifecycle", () => {
    // The failure mode being designed out: a paragraph that would be true of
    // any account in the same state, which is the same as saying nothing.
    const p = buildNarrativePrompt(base);
    expect(p).toContain("get_customer");
    expect(p).toMatch(/transcripts attached/i);
    expect(p).toMatch(/name and lifecycle alone/i);
  });

  it("requires citations, and says why", () => {
    const p = buildNarrativePrompt(base);
    expect(p).toContain("`sources`");
    expect(p).toMatch(/least able to check/i);
  });

  it("tells him to be thin when the evidence is thin", () => {
    // A confident paragraph built on nothing is worse than an honest short one,
    // because the confident one gets believed.
    const p = buildNarrativePrompt(base);
    expect(p).toMatch(/two emails and no meetings/i);
    expect(p).toMatch(/gets believed/i);
  });

  it("forbids reaching the customer", () => {
    const p = buildNarrativePrompt(base);
    expect(p).toMatch(/do not write to the customer/i);
    expect(p).toMatch(/do not raise anything/i);
  });
});
