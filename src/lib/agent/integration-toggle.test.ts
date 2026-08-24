/**
 * Per-org integration on/off.
 *
 * The property that matters is DEFAULT OFF, and the reason is not caution for
 * its own sake: on 20 August a deployment-wide Scribe token acted for three
 * organisations that had never asked for it, because possession of a credential
 * was treated as permission. A tenant appearing with working credentials must do
 * nothing until a human says so.
 *
 * The second property is that "off" survives being read wrongly — a lookup
 * failure yields off, never on.
 */
import { describe, expect, it, vi } from "vitest";
import { TOGGLEABLE, setEnabled, toggleState } from "./integration-toggle";

const ORG = "11111111-1111-1111-1111-111111111111";

/** Serves one integrations row, records writes, or throws on read. */
function db(row: Record<string, unknown> | null, opts: { failRead?: boolean } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];

  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (opts.failRead) throw new Error("connection reset");
          return { data: row, error: null };
        },
        upsert: async (payload: Record<string, unknown>) => {
          writes.push(payload);
          return { error: null };
        },
        insert: async (payload: Record<string, unknown>) => {
          if (table === "audit_log") audits.push(payload);
          return { error: null };
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { admin, writes, audits };
}

describe("default off", () => {
  it("is off when there is no row at all", async () => {
    // A newly provisioned tenant. Credentials present, nobody asked for it.
    const s = await toggleState(db(null).admin, ORG, "scribe", true);
    expect(s.enabled).toBe(false);
    expect(s.active).toBe(false);
    expect(s.reason).toContain("nobody has switched it on");
  });

  it("is off when the row exists but was never enabled", async () => {
    const s = await toggleState(
      db({ status: "pending", metadata: {} }).admin,
      ORG,
      "nylas",
      true,
    );
    expect(s.active).toBe(false);
  });

  it("requires BOTH facts, not either", async () => {
    const enabledRow = { status: "connected", metadata: { enabled: true } };

    // Enabled but no credential.
    const noCred = await toggleState(db(enabledRow).admin, ORG, "scribe", false);
    expect(noCred.active).toBe(false);
    expect(noCred.reason).toContain("no credential");

    // Credential but not enabled.
    const notOn = await toggleState(
      db({ status: "disconnected", metadata: { enabled: false } }).admin,
      ORG,
      "scribe",
      true,
    );
    expect(notOn.active).toBe(false);

    // Both.
    const both = await toggleState(db(enabledRow).admin, ORG, "scribe", true);
    expect(both.active).toBe(true);
  });

  it("does not treat a connected status alone as consent", async () => {
    // status could be set by other code paths; the explicit flag is the consent.
    const s = await toggleState(
      db({ status: "connected", metadata: {} }).admin,
      ORG,
      "parchment",
      true,
    );
    expect(s.enabled).toBe(false);
  });
});

describe("it fails closed", () => {
  it("reports off when the settings cannot be read", async () => {
    const s = await toggleState(db(null, { failRead: true }).admin, ORG, "nylas", true);
    expect(s.active).toBe(false);
    expect(s.reason).toContain("treated as off");
  });
});

describe("toggling", () => {
  it("keeps the credential when switching off", async () => {
    // Off must be cheap. If turning something off costs a token nobody has to
    // hand, nobody turns it off in the emergency where it matters.
    const existing = {
      status: "connected",
      metadata: { enabled: true, grant_id: "keep-me", workspace: "ws-1" },
    };
    const { admin, writes } = db(existing);

    await setEnabled(admin, ORG, "nylas", false, "vidhi@aixccelerate.com");

    const meta = writes[0].metadata as Record<string, unknown>;
    expect(meta.grant_id).toBe("keep-me");
    expect(meta.workspace).toBe("ws-1");
    expect(meta.enabled).toBe(false);
    expect(writes[0].status).toBe("disconnected");
  });

  it("records who and when", async () => {
    const { admin, writes } = db(null);
    await setEnabled(admin, ORG, "scribe", true, "rahul@aixccelerate.com");

    const meta = writes[0].metadata as Record<string, unknown>;
    expect(meta.changed_by).toBe("rahul@aixccelerate.com");
    expect(typeof meta.changed_at).toBe("string");
  });

  it("writes an audit row so the change is findable later", async () => {
    // "When did George stop doing this, and who stopped it" is the question
    // asked after every incident.
    const { admin, audits } = db(null);
    await setEnabled(admin, ORG, "parchment", false, "vidhi@aixccelerate.com");

    expect(audits[0].action).toBe("integration.disabled");
    expect((audits[0].payload as Record<string, unknown>).integration).toBe("parchment");
    expect(audits[0].actor).toBe("vidhi@aixccelerate.com");
  });

  it("round-trips: on, off, on again", async () => {
    const { admin, writes } = db({ status: "pending", metadata: { token_ref: "abc" } });
    await setEnabled(admin, ORG, "scribe", true, "a@b.com");
    await setEnabled(admin, ORG, "scribe", false, "a@b.com");
    await setEnabled(admin, ORG, "scribe", true, "a@b.com");

    for (const w of writes) {
      expect((w.metadata as Record<string, unknown>).token_ref).toBe("abc");
    }
    expect(writes.at(-1)!.status).toBe("connected");
  });
});

describe("the set of toggleable integrations", () => {
  it("covers Scribe, Nylas and Parchment", () => {
    expect([...TOGGLEABLE].sort()).toEqual(["nylas", "parchment", "scribe"]);
  });

  it("excludes AgentDB, whose enablement is not ours to store", () => {
    // AgentDB is gated on a Core entitlement check needing a human's Clerk
    // token, so it cannot be a row we flip. Listing it here would imply a
    // control that does not exist.
    expect(TOGGLEABLE as readonly string[]).not.toContain("agentdb");
  });

  it("uses only values the integration_provider enum accepts", () => {
    // Migration 0002 added nylas and scribe; parchment predates it. A value
    // outside the enum makes every lookup error and silently fall back —
    // exactly the bug found in resolveGeorgeOrgId.
    const enumValues = ["composio", "m365", "fireflies", "onedrive", "zoho", "gmail", "slack", "custom", "parchment", "nylas", "scribe"];
    for (const t of TOGGLEABLE) expect(enumValues).toContain(t);
  });
});
