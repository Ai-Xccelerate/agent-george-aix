/**
 * Noticing that nobody answered.
 *
 * Every other signal in this system reacts to something happening. This one
 * fires on the absence of an event, which means nothing else will catch it if
 * this is wrong — a broken silence sweep does not error, it just quietly stops
 * noticing, and looks identical to a book of healthy accounts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { clearTenantProcessCache } from "./tenant-process";
import { sweepSilence } from "./silence-sweep";

const ORG = "org-1";
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

type Row = Record<string, unknown>;

let touchpoints: Row[] = [];
let silentCount = 0;
let openEscalations: Row[] = [];
let updates: Array<{ table: string; payload: Row }> = [];
let inserts: Array<{ table: string; payload: Row }> = [];
let silenceDays = 5;
let escalateAfter = 2;

function db() {
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean; count?: string }) => {
          if (table === "onboarding_touchpoint" && (o?.head || o?.count)) {
            return { eq: () => ({ eq: async () => ({ count: silentCount, error: null }) }) };
          }
          return chain;
        },
        eq: () => chain,
        is: () => chain,
        not: () => chain,
        ilike: () => chain,
        order: () => chain,
        limit: async () => ({
          data:
            table === "onboarding_touchpoint"
              ? touchpoints
              : table === "escalations"
                ? openEscalations
                : [],
          error: null,
        }),
        maybeSingle: async () => ({
          data:
            table === "customers"
              ? { name: "Northwind" }
              : table === "tenant_process"
                ? {
                    id: "p1",
                    org_id: ORG,
                    type: "onboarding",
                    objective: "Go",
                    stages: [{ key: "s", name: "S", description: "d" }],
                    touchpoints: [{ key: "welcome", day_offset: 0, purpose: "p", ask: "a" }],
                    escalation: {
                      silence_days: silenceDays,
                      silence_escalate_after: escalateAfter,
                      rules: [],
                      notify: "owner",
                    },
                    voice: null,
                    first_value: { configured: true },
                  }
                : null,
          error: null,
        }),
        update: (payload: Row) => {
          updates.push({ table, payload });
          return { eq: () => ({ is: async () => ({ error: null }) }) };
        },
        insert: async (payload: Row) => {
          inserts.push({ table, payload });
          return { error: null };
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return admin;
}

function sent(over: Row = {}): Row {
  return {
    id: "tp-1",
    org_id: ORG,
    customer_id: "cust-1",
    plan_id: "plan-1",
    touchpoint_key: "access_check",
    sent_at: daysAgo(9),
    recipient_email: "dana@acme.example",
    ...over,
  };
}

beforeEach(() => {
  clearTenantProcessCache();
  touchpoints = [];
  openEscalations = [];
  updates = [];
  inserts = [];
  silentCount = 0;
  silenceDays = 5;
  escalateAfter = 2;
});

const health = () => inserts.filter((i) => i.table === "customer_health");
const escalations = () => inserts.filter((i) => i.table === "escalations");

describe("it fires on absence, at the tenant's own window", () => {
  it("marks a send nobody answered", async () => {
    touchpoints = [sent()];
    const r = await sweepSilence(db());

    expect(r.marked).toBe(1);
    expect(updates[0].payload.status).toBe("silent");
    expect(updates[0].payload.silence_escalated_at).toBeTruthy();
  });

  it("leaves a send inside the window alone", async () => {
    touchpoints = [sent({ sent_at: daysAgo(3) })];
    expect((await sweepSilence(db())).marked).toBe(0);
  });

  it("uses the tenant's silence_days, not a global constant", async () => {
    touchpoints = [sent({ sent_at: daysAgo(4) })];

    silenceDays = 3;
    expect((await sweepSilence(db())).marked).toBe(1);

    clearTenantProcessCache();
    updates = [];
    silenceDays = 10;
    expect((await sweepSilence(db())).marked).toBe(0);
  });

  it("does nothing for a tenant with no usable process", async () => {
    // The window and the threshold are both theirs to set. Guessing them is the
    // same invention the resolver refuses everywhere else.
    touchpoints = [sent()];
    const admin = db();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orig = (admin as any).from;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from = (t: string) =>
      t === "tenant_process"
        ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }
        : orig(t);

    expect((await sweepSilence(admin)).marked).toBe(0);
  });
});

describe("what it records", () => {
  it("writes a health signal naming the touchpoint and the age", async () => {
    touchpoints = [sent()];
    await sweepSilence(db());

    expect(health()).toHaveLength(1);
    expect(health()[0].payload.reason).toContain("access_check");
    expect(health()[0].payload.reason).toContain("9 days");
  });

  it("writes yellow, not red, for a single unanswered email", async () => {
    // One unanswered email is a busy person at least as often as a failing
    // account. Crying red at the first makes the band meaningless by the time
    // it matters.
    touchpoints = [sent()];
    await sweepSilence(db());
    expect(health()[0].payload.band).toBe("yellow");
  });

  it("does not write to the customer", async () => {
    // Deciding to chase somebody who has ignored two emails is a judgement
    // about a relationship. The sweep records; a person decides.
    touchpoints = [sent()];
    silentCount = 5;
    await sweepSilence(db());

    expect(inserts.map((i) => i.table)).not.toContain("email_messages");
    expect(escalations()[0].payload.recommendation).toContain("will not chase again");
  });
});

describe("escalation is once, past the tenant's threshold", () => {
  it("stays quiet below the threshold", async () => {
    touchpoints = [sent()];
    silentCount = 1;
    escalateAfter = 2;
    const r = await sweepSilence(db());

    expect(r.escalated).toBe(0);
    expect(escalations()).toHaveLength(0);
  });

  it("raises a decision at the threshold", async () => {
    touchpoints = [sent()];
    silentCount = 2;
    escalateAfter = 2;
    const r = await sweepSilence(db());

    expect(r.escalated).toBe(1);
    expect(escalations()[0].payload.title).toContain("has gone quiet");
  });

  it("does not raise a second decision while one is open", async () => {
    // Somebody who has ignored three emails does not need three identical
    // decisions about it.
    touchpoints = [sent()];
    silentCount = 3;
    openEscalations = [{ id: "esc-1" }];
    const r = await sweepSilence(db());

    expect(r.escalated).toBe(0);
  });

  it("says why it is worth looking at now rather than at renewal", async () => {
    touchpoints = [sent()];
    silentCount = 2;
    await sweepSilence(db());
    expect(escalations()[0].payload.detail).toContain("never say so");
  });
});

describe("it cannot take the tick down", () => {
  it("returns zeroes when the database throws", async () => {
    const admin = {
      from() {
        throw new Error("connection reset");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(await sweepSilence(admin)).toEqual({ marked: 0, health: 0, escalated: 0 });
  });

  it("does nothing when there is nothing to do", async () => {
    expect(await sweepSilence(db())).toEqual({ marked: 0, health: 0, escalated: 0 });
  });
});
