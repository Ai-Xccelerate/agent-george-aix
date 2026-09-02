/**
 * The single guarded send path.
 *
 * Two mechanisms meet here and neither has ever fired in production:
 *
 *   the recipient allowlist — armed on 2026-08-20 and with nothing to refuse,
 *   because every recipient that day was internal;
 *
 *   the volume ceiling — which did not exist that day, and is the axis the
 *   incident actually ran along: 16 sends in 90 minutes, every one authorised.
 *
 * `email.send_blocked` is still zero for all time. These tests are the only
 * place either guard has been observed doing its job, until item 10 fires them
 * against a real provider.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDraft = vi.fn();
const sendDraft = vi.fn();

vi.mock("@/lib/nylas/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nylas/client")>()),
  nylasConfig: () => ({ apiKey: "k", apiUri: "https://api", grantId: "g", from: "george@aiwkr.com" }),
  createNylasClient: () => ({ getDraft, sendDraft }),
}));

vi.mock("./identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./identity")>()),
  resolveOrgIdentity: async () => ({
    internalDomains: new Set(["aixccelerate.com", "aiwkr.com"]),
    address: "george@aiwkr.com",
    domain: "aixccelerate.com",
  }),
}));

const { sendDraftGuarded } = await import("./send-guarded");
const ORG = "org-1";

let audits: Array<{ action: string; actor: string; payload: Record<string, unknown> }> = [];
let sentLastHour = 0;
let approved: string[] = [];

/** Enough of the client for the guard: a rate count, an allowlist, an audit sink. */
function db() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean; count?: string }) => {
          if (table === "audit_log" && (o?.head || o?.count)) {
            return {
              eq: () => ({
                eq: () => ({ gte: async () => ({ count: sentLastHour, error: null }) }),
                gte: async () => ({ count: sentLastHour, error: null }),
              }),
            };
          }
          return chain;
        },
        eq: () => chain,
        gte: async () => ({ count: sentLastHour, error: null }),
        insert: async (payload: Record<string, unknown>) => {
          audits.push(payload as never);
          return { error: null };
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: approved.map((d) => ({ domain: d })), error: null }),
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const base = {
  orgId: ORG,
  draftId: "draft-1",
  actor: "user-1",
  mode: "chat" as const,
};

beforeEach(() => {
  audits = [];
  sentLastHour = 0;
  approved = [];
  getDraft.mockReset();
  sendDraft.mockReset();
  getDraft.mockResolvedValue({ ok: true, data: { to: [{ email: "dana@acme.example" }] } });
  sendDraft.mockResolvedValue({ ok: true, data: { id: "msg-1" } });
});

const blocked = () => audits.filter((a) => a.action === "email.send_blocked");

describe("the recipient allowlist", () => {
  it("refuses an unapproved external domain and does not call the provider", async () => {
    const res = await sendDraftGuarded({ ...base, db: db() });

    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("domain_not_approved");
    expect(sendDraft).not.toHaveBeenCalled();
  });

  it("writes email.send_blocked, naming the domain that was refused", async () => {
    // This audit row is the thing that has never once appeared. If the guard
    // ever silently allows, this is the assertion that catches it.
    await sendDraftGuarded({ ...base, db: db() });

    expect(blocked()).toHaveLength(1);
    expect(blocked()[0].payload.not_allowed).toEqual(["dana@acme.example"]);
  });

  it("allows an external domain once it is on the allowlist", async () => {
    approved = ["acme.example"];
    const res = await sendDraftGuarded({ ...base, db: db() });

    expect(res.ok).toBe(true);
    expect(sendDraft).toHaveBeenCalledWith("draft-1");
    expect(blocked()).toHaveLength(0);
  });

  it("allows internal recipients without an allowlist entry", async () => {
    getDraft.mockResolvedValue({ ok: true, data: { to: [{ email: "manasa@aixccelerate.com" }] } });
    expect((await sendDraftGuarded({ ...base, db: db() })).ok).toBe(true);
  });

  it("refuses when ANY recipient is unapproved, not just the first", async () => {
    approved = ["acme.example"];
    getDraft.mockResolvedValue({
      ok: true,
      data: { to: [{ email: "ok@acme.example" }], cc: [{ email: "stranger@elsewhere.example" }] },
    });
    const res = await sendDraftGuarded({ ...base, db: db() });

    expect(res.ok).toBe(false);
    expect(blocked()[0].payload.not_allowed).toEqual(["stranger@elsewhere.example"]);
  });

  it("reads recipients from the provider, not from the caller", async () => {
    // A draft can be edited between composition and approval. The guard has to
    // see what will actually go, not what was composed.
    await sendDraftGuarded({ ...base, db: db() });
    expect(getDraft).toHaveBeenCalledWith("draft-1");
  });

  it("fails closed when recipients cannot be read", async () => {
    getDraft.mockResolvedValue({ ok: true, data: {} });
    const res = await sendDraftGuarded({ ...base, db: db() });

    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("recipients_unparsed");
    expect(sendDraft).not.toHaveBeenCalled();
    expect(blocked()).toHaveLength(1);
  });
});

describe("the volume ceiling", () => {
  it("refuses the fourth autonomous send in an hour", async () => {
    approved = ["acme.example"];
    sentLastHour = 3;
    const res = await sendDraftGuarded({ ...base, db: db(), mode: "autonomous" });

    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("rate_limited");
    expect(sendDraft).not.toHaveBeenCalled();
    expect(blocked()[0].payload.cap).toBe(3);
  });

  it("allows the third", async () => {
    approved = ["acme.example"];
    sentLastHour = 2;
    expect((await sendDraftGuarded({ ...base, db: db(), mode: "autonomous" })).ok).toBe(true);
  });

  it("gives an approved send the higher ceiling", async () => {
    // The relaxation is earned by a human authorising each send, which is what
    // the approval path verifies before passing mode: "chat".
    approved = ["acme.example"];
    sentLastHour = 3;
    expect((await sendDraftGuarded({ ...base, db: db(), mode: "chat" })).ok).toBe(true);
  });

  it("still refuses past the chat ceiling", async () => {
    approved = ["acme.example"];
    sentLastHour = 15;
    const res = await sendDraftGuarded({ ...base, db: db(), mode: "chat" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("rate_limited");
  });

  it("checks volume before touching the provider", async () => {
    // Cheaper, and it means a runaway loop cannot hammer the mail API while
    // being refused.
    sentLastHour = 99;
    await sendDraftGuarded({ ...base, db: db(), mode: "autonomous" });
    expect(getDraft).not.toHaveBeenCalled();
  });
});

describe("what the audit records", () => {
  it("records who sent it and how it was authorised", async () => {
    approved = ["acme.example"];
    await sendDraftGuarded({
      ...base,
      db: db(),
      auditExtra: { via: "approval", escalation_id: "esc-1" },
    });

    const sent = audits.find((a) => a.action === "email.sent")!;
    expect(sent.actor).toBe("user-1");
    expect(sent.payload.via).toBe("approval");
    expect(sent.payload.escalation_id).toBe("esc-1");
    expect(sent.payload.mode).toBe("chat");
    expect(sent.payload.to).toEqual(["dana@acme.example"]);
  });

  it("does not record a send that did not happen", async () => {
    await sendDraftGuarded({ ...base, db: db() });
    expect(audits.find((a) => a.action === "email.sent")).toBeUndefined();
  });
});
