/**
 * The process resolver, and the one thing it must never do: proceed.
 *
 * identity.ts falls through to env when it cannot read the org, because its
 * degraded answer is stricter and therefore safe. This has no safe degraded
 * answer — the degraded version of "what is this tenant's onboarding process"
 * is a process George invented and then executed against a real customer in the
 * tenant's name. So every one of these tests is a way of asking "does it still
 * refuse".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearTenantProcessCache,
  isFirstValueConfigured,
  resolveTenantProcess,
  TenantProcessMissingError,
  type TenantProcess,
} from "./tenant-process";

const ORG = "101959fa-084e-4a46-b51f-d289b02d746c";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    org_id: ORG,
    type: "onboarding",
    objective: "Get to first value quickly.",
    stages: [{ key: "signed", name: "Signed", description: "Contract executed." }],
    touchpoints: [
      { key: "value_check", day_offset: 21, purpose: "Check value.", ask: "Confirm." },
      { key: "welcome", day_offset: 0, purpose: "Introduce.", ask: "Confirm contact." },
    ],
    escalation: { silence_days: 5, silence_escalate_after: 2, rules: [], notify: "owner" },
    voice: "Plain and short.",
    first_value: { label: "L", definition: "D", target_days: 21, evidence: "E", configured: false },
    ...over,
  };
}

/** Serves one row, or an error, and counts reads so caching is observable. */
function db(opts: { data?: Record<string, unknown> | null; error?: string } = {}) {
  let reads = 0;
  const admin = {
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          reads++;
          if (opts.error) return { data: null, error: { message: opts.error } };
          return { data: opts.data === undefined ? row() : opts.data, error: null };
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, reads: () => reads };
}

beforeEach(() => clearTenantProcessCache());
afterEach(() => clearTenantProcessCache());

describe("it reads the tenant's own process", () => {
  it("returns the record", async () => {
    const p = await resolveTenantProcess(db().admin, ORG);
    expect(p.objective).toBe("Get to first value quickly.");
    expect(p.voice).toBe("Plain and short.");
  });

  it("orders touchpoints by day so no caller has to remember to sort", async () => {
    const p = await resolveTenantProcess(db().admin, ORG);
    expect(p.touchpoints.map((t) => t.key)).toEqual(["welcome", "value_check"]);
  });

  it("caches, so composing a prompt does not re-read per block", async () => {
    const d = db();
    await resolveTenantProcess(d.admin, ORG);
    await resolveTenantProcess(d.admin, ORG);
    expect(d.reads()).toBe(1);
  });

  it("re-reads after the cache is cleared, so an edit takes effect", async () => {
    const d = db();
    await resolveTenantProcess(d.admin, ORG);
    clearTenantProcessCache(ORG);
    await resolveTenantProcess(d.admin, ORG);
    expect(d.reads()).toBe(2);
  });
});

describe("it refuses rather than composing around a gap", () => {
  it("throws when there is no process record", async () => {
    await expect(resolveTenantProcess(db({ data: null }).admin, ORG)).rejects.toBeInstanceOf(
      TenantProcessMissingError,
    );
  });

  it("throws when the record cannot be read at all", async () => {
    // The inversion from identity.ts: "could not tell" and "not there" both
    // refuse, because proceeding on either means inventing the process.
    await expect(
      resolveTenantProcess(db({ error: "connection reset" }).admin, ORG),
    ).rejects.toThrow(/could not be read/);
  });

  it("throws when the record exists but defines no touchpoints", async () => {
    // A row that says nothing is not a weaker process, it is the absence of
    // one wearing a row.
    await expect(
      resolveTenantProcess(db({ data: row({ touchpoints: [] }) }).admin, ORG),
    ).rejects.toThrow(/no touchpoints/);
  });

  it("throws when it defines no stages", async () => {
    await expect(
      resolveTenantProcess(db({ data: row({ stages: [] }) }).admin, ORG),
    ).rejects.toThrow(/no stages/);
  });

  it("throws when it states no objective", async () => {
    await expect(
      resolveTenantProcess(db({ data: row({ objective: "   " }) }).admin, ORG),
    ).rejects.toThrow(/no objective/);
  });

  it("names the organisation and the reason, so the UI can say why", async () => {
    try {
      await resolveTenantProcess(db({ data: null }).admin, ORG);
      throw new Error("should have refused");
    } catch (e) {
      const err = e as TenantProcessMissingError;
      expect(err.orgId).toBe(ORG);
      expect(err.why).toContain("no process record");
      expect(err.message).toContain("George will not onboard");
    }
  });

  it("does not cache a refusal", async () => {
    // Otherwise defining the process would not take effect for a minute, and
    // the person who just fixed it would think it had not worked.
    const missing = db({ data: null });
    await expect(resolveTenantProcess(missing.admin, ORG)).rejects.toThrow();
    const present = db();
    await expect(resolveTenantProcess(present.admin, ORG)).resolves.toBeTruthy();
  });
});

describe("first_value is only configured when it says so", () => {
  it("treats a missing flag as not configured", async () => {
    const p = await resolveTenantProcess(
      db({ data: row({ first_value: { label: "L", definition: "D" } }) }).admin,
      ORG,
    );
    expect(isFirstValueConfigured(p)).toBe(false);
  });

  it("treats a truthy-but-not-true value as not configured", async () => {
    const p = await resolveTenantProcess(
      db({ data: row({ first_value: { configured: "yes" } }) }).admin,
      ORG,
    );
    expect(isFirstValueConfigured(p)).toBe(false);
  });

  it("is configured only on an explicit true", async () => {
    const p = await resolveTenantProcess(
      db({ data: row({ first_value: { label: "L", definition: "D", target_days: 14, evidence: "E", configured: true } }) })
        .admin,
      ORG,
    );
    expect(isFirstValueConfigured(p)).toBe(true);
  });
});

describe("the seeded default and the code agree", () => {
  // Migration 0004 seeded every existing org from constants written in Python.
  // Nothing stops those and the TypeScript understanding of the same shape from
  // drifting, and the drift would be silent — George would read fields that are
  // not there. So the migration is parsed and checked directly.
  const migration = readFileSync(
    join(process.cwd(), "db/alembic/versions/0004_tenant_process.py"),
    "utf8",
  );

  function pyJson(name: string): unknown {
    const m = migration.match(new RegExp(`${name} = """([\\s\\S]*?)"""`));
    if (!m) throw new Error(`could not find ${name} in migration 0004`);
    return JSON.parse(m[1]);
  }

  it("seeds touchpoints with the keys the resolver expects", () => {
    const tps = pyJson("DEFAULT_TOUCHPOINTS") as Array<Record<string, unknown>>;
    expect(tps.length).toBeGreaterThan(0);
    for (const t of tps) {
      expect(typeof t.key).toBe("string");
      expect(typeof t.day_offset).toBe("number");
      expect(typeof t.purpose).toBe("string");
      expect(typeof t.ask).toBe("string");
    }
  });

  it("weights the default touchpoints to the first 30 days", () => {
    const tps = pyJson("DEFAULT_TOUCHPOINTS") as Array<{ day_offset: number }>;
    expect(Math.max(...tps.map((t) => t.day_offset))).toBeLessThanOrEqual(30);
    const firstWeek = tps.filter((t) => t.day_offset <= 7).length;
    expect(firstWeek).toBeGreaterThanOrEqual(tps.length / 2);
  });

  it("seeds first_value as explicitly unconfigured", () => {
    // The whole surfacing story depends on this being false out of the box.
    const fv = pyJson("DEFAULT_FIRST_VALUE") as Record<string, unknown>;
    expect(fv.configured).toBe(false);
    expect(typeof fv.target_days).toBe("number");
  });

  it("seeds an escalation the resolver can read", () => {
    const esc = pyJson("DEFAULT_ESCALATION") as Record<string, unknown>;
    expect(typeof esc.silence_days).toBe("number");
    expect(typeof esc.silence_escalate_after).toBe("number");
    expect(Array.isArray(esc.rules)).toBe(true);
  });

  it("seeds stages with a first_value milestone between signature and go-live", () => {
    const stages = pyJson("DEFAULT_STAGES") as Array<{ key: string }>;
    const keys = stages.map((s) => s.key);
    expect(keys).toContain("first_value");
    expect(keys.indexOf("first_value")).toBeGreaterThan(keys.indexOf("signed"));
    expect(keys.indexOf("first_value")).toBeLessThan(keys.indexOf("live"));
  });
});

describe("the shape the rest of the feature relies on", () => {
  it("exposes escalation defaults when the blob is partial", async () => {
    const p: TenantProcess = await resolveTenantProcess(
      db({ data: row({ escalation: {} }) }).admin,
      ORG,
    );
    expect(p.escalation.silence_days).toBe(5);
    expect(p.escalation.silence_escalate_after).toBe(2);
  });

  it("normalises an empty voice to null so precedence is unambiguous", async () => {
    const p = await resolveTenantProcess(db({ data: row({ voice: "   " }) }).admin, ORG);
    expect(p.voice).toBeNull();
  });
});
