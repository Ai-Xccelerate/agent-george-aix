/**
 * The outbound send guard.
 *
 * This is the security-critical part of George's email: it is what stops a
 * prompt-injected agent from emailing anyone it likes. The rules are that every
 * recipient must be internal OR on the org's approved domain allowlist, that it
 * fails CLOSED when recipients can't be read, and that it re-reads the draft
 * from the provider rather than trusting what the model said at draft time.
 *
 * These run with the Nylas client mocked, so no mailbox and no key are needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const getDraft = vi.fn();
const sendDraft = vi.fn();
const createDraft = vi.fn();
const getMessage = vi.fn();

vi.mock("@/lib/nylas/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nylas/client")>();
  return {
    ...actual,
    nylasConfig: () => ({
      base: "https://api.us.nylas.com",
      apiKey: "k",
      grantId: "g",
      fromEmail: "george@aiwkr.com",
      fromName: "George",
    }),
    createNylasClient: () => ({ getDraft, sendDraft, createDraft, getMessage }),
  };
});

const { buildNylasEmailTools } = await import("./nylas-tools");

/**
 * Records audit rows, serves the domain allowlist, and answers the
 * sends-this-hour count that the volume limit checks.
 */
function fakeDb(approved: string[] = [], sentLastHour = 0) {
  const audits: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      if (table === "audit_log") {
        // Either a count query (the volume limit) or an insert (an audit row).
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: async () => ({ count: sentLastHour, error: null }),
              }),
            }),
          }),
          insert: async (row: { action: string; payload: Record<string, unknown> }) => {
            audits.push({ action: row.action, payload: row.payload });
            return { error: null };
          },
        } as never;
      }
      if (table === "domain_allowlist") {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          then: undefined,
        };
        // resolve on await of the final .eq()
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: approved.map((domain) => ({ domain })), error: null }),
            }),
          }),
        } as never;
      }
      return {
        insert: async (row: { action: string; payload: Record<string, unknown> }) => {
          audits.push({ action: row.action, payload: row.payload });
          return { error: null };
        },
      } as never;
    },
  } as unknown as SupabaseClient;
  return { db, audits };
}

function tools(approved: string[] = [], sentLastHour = 0) {
  const { db, audits } = fakeDb(approved, sentLastHour);
  const list = buildNylasEmailTools({
    orgId: "org-1",
    userId: null,
    sessionId: null,
    db,
  });
  const byName = Object.fromEntries(list.map((t) => [t.name, t])) as unknown as Record<
    string,
    { handler: (a: Record<string, unknown>, b: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }
  >;
  return { byName, audits };
}

const draftWith = (to: string[], cc: string[] = [], bcc: string[] = []) => ({
  ok: true as const,
  data: {
    id: "d1",
    to: to.map((email) => ({ email })),
    cc: cc.map((email) => ({ email })),
    bcc: bcc.map((email) => ({ email })),
  },
});

beforeEach(() => {
  process.env.GEORGE_EMAIL = "george@aiwkr.com";
  process.env.GEORGE_INTERNAL_DOMAINS = "aixccelerate.com";
  vi.clearAllMocks();
  sendDraft.mockResolvedValue({ ok: true, data: { id: "sent-1" } });
});

afterEach(() => {
  delete process.env.GEORGE_EMAIL;
  delete process.env.GEORGE_INTERNAL_DOMAINS;
});

describe("send_email_draft guard", () => {
  it("sends when every recipient is internal", async () => {
    getDraft.mockResolvedValue(draftWith(["vidhi@aixccelerate.com"]));
    const { byName, audits } = tools();

    const res = await byName.send_email_draft.handler({ draft_id: "d1" }, {});

    expect(res.isError).toBeFalsy();
    expect(sendDraft).toHaveBeenCalledWith("d1");
    expect(audits.map((a) => a.action)).toContain("email.sent");
  });

  it("refuses an external recipient whose domain is not approved", async () => {
    getDraft.mockResolvedValue(draftWith(["stranger@randomcorp.com"]));
    const { byName, audits } = tools([]);

    const res = await byName.send_email_draft.handler({ draft_id: "d1" }, {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not approved|isn't approved/i);
    // The send must not have happened at all, not merely been reported as failed.
    expect(sendDraft).not.toHaveBeenCalled();
    expect(audits.map((a) => a.action)).toContain("email.send_blocked");
  });

  it("sends to an external recipient once its domain IS approved", async () => {
    getDraft.mockResolvedValue(draftWith(["buyer@customer.com"]));
    const { byName } = tools(["customer.com"]);

    const res = await byName.send_email_draft.handler({ draft_id: "d1" }, {});

    expect(res.isError).toBeFalsy();
    expect(sendDraft).toHaveBeenCalledWith("d1");
  });

  it("refuses when ANY recipient is unapproved, even if others are fine", async () => {
    getDraft.mockResolvedValue(
      draftWith(["vidhi@aixccelerate.com"], ["buyer@customer.com"], ["leak@elsewhere.com"]),
    );
    const { byName } = tools(["customer.com"]);

    const res = await byName.send_email_draft.handler({ draft_id: "d1" }, {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("leak@elsewhere.com");
    expect(sendDraft).not.toHaveBeenCalled();
  });

  it("checks bcc — the field the old Graph path never parsed", async () => {
    getDraft.mockResolvedValue(draftWith(["vidhi@aixccelerate.com"], [], ["secret@outsider.com"]));
    const { byName } = tools();

    const res = await byName.send_email_draft.handler({ draft_id: "d1" }, {});

    // A bcc'd stranger is exactly how an exfiltration would be hidden.
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("secret@outsider.com");
    expect(sendDraft).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the draft has no readable recipients", async () => {
    getDraft.mockResolvedValue({ ok: true, data: { id: "d1" } });
    const { byName, audits } = tools();

    const res = await byName.send_email_draft.handler({ draft_id: "d1" }, {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/could not confirm|couldn't confirm/i);
    expect(sendDraft).not.toHaveBeenCalled();
    expect(audits.find((a) => a.action === "email.send_blocked")?.payload.reason).toBe(
      "recipients_unparsed",
    );
  });

  it("fails CLOSED when the allowlist query errors", async () => {
    getDraft.mockResolvedValue(draftWith(["buyer@customer.com"]));
    // An allowlist that can't be read must mean "allow nothing", never
    // "allow everything".
    const db = {
      from: (t: string) => {
        if (t === "domain_allowlist") {
          return {
            select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { message: "boom" } }) }) }),
          } as never;
        }
        // audit_log serves both the volume-limit count and the audit insert.
        return {
          select: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({ count: 0, error: null }) }) }) }),
          insert: async () => ({ error: null }),
        } as never;
      },
    } as unknown as SupabaseClient;

    const list = buildNylasEmailTools({ orgId: "o", userId: null, sessionId: null, db });
    const send = list.find((t) => t.name === "send_email_draft")!;
    const res = await (send as unknown as { handler: (a: unknown, b: unknown) => Promise<{ isError?: boolean }> })
      .handler({ draft_id: "d1" }, {});

    expect(res.isError).toBe(true);
    expect(sendDraft).not.toHaveBeenCalled();
  });

  it("re-reads the draft from the provider before sending", async () => {
    getDraft.mockResolvedValue(draftWith(["vidhi@aixccelerate.com"]));
    const { byName } = tools();

    await byName.send_email_draft.handler({ draft_id: "d1" }, {});

    // Trusting the model's earlier claim about recipients would defeat the guard.
    expect(getDraft).toHaveBeenCalledWith("d1");
  });

  it("surfaces a provider error rather than throwing", async () => {
    getDraft.mockResolvedValue({ ok: false, error: "Nylas returned 404: no such draft" });
    const { byName } = tools();

    const res = await byName.send_email_draft.handler({ draft_id: "nope" }, {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/404/);
  });
});

describe("draft_email_reply", () => {
  it("replies to internal people only and reports who was excluded", async () => {
    getMessage.mockResolvedValue({
      ok: true,
      data: {
        id: "m1",
        thread_id: "t1",
        subject: "Onboarding",
        body: "<p>original</p>",
        from: [{ email: "colleague@aixccelerate.com" }],
        to: [{ email: "george@aiwkr.com" }, { email: "customer@outsider.com" }],
        cc: [{ email: "other@aixccelerate.com" }],
      },
    });
    createDraft.mockResolvedValue({ ok: true, data: { id: "reply-1" } });
    const { byName } = tools();

    const res = await byName.draft_email_reply.handler(
      { message_id: "m1", body_html: "<p>reply</p>" },
      {},
    );

    const payload = JSON.parse(res.content[0].text);
    expect(payload.to).toEqual(["colleague@aixccelerate.com"]);
    expect(payload.cc).toEqual(["other@aixccelerate.com"]);
    // The external participant must be reported, not silently included.
    expect(payload.excluded_external).toEqual(["customer@outsider.com"]);
    expect(payload.reply_scope).toBe("internal_only");
    // George must never be a recipient of its own reply.
    expect(payload.to).not.toContain("george@aiwkr.com");
  });

  it("falls back to the sender on a thread with no internal participants, and flags it", async () => {
    getMessage.mockResolvedValue({
      ok: true,
      data: {
        id: "m2",
        subject: "Re: Question",
        body: "<p>x</p>",
        from: [{ email: "customer@outsider.com" }],
        to: [{ email: "george@aiwkr.com" }],
      },
    });
    createDraft.mockResolvedValue({ ok: true, data: { id: "reply-2" } });
    const { byName } = tools();

    const res = await byName.draft_email_reply.handler(
      { message_id: "m2", body_html: "<p>reply</p>" },
      {},
    );

    const payload = JSON.parse(res.content[0].text);
    expect(payload.to).toEqual(["customer@outsider.com"]);
    expect(payload.reply_scope).toBe("external_fallback");
    // Drafting is allowed; the send guard is what still stands in the way.
    expect(res.isError).toBeFalsy();
  });

  it("keeps the reply threaded at the provider", async () => {
    getMessage.mockResolvedValue({
      ok: true,
      data: { id: "m3", subject: "Hello", body: "<p>x</p>", from: [{ email: "a@aixccelerate.com" }] },
    });
    createDraft.mockResolvedValue({ ok: true, data: { id: "reply-3" } });
    const { byName } = tools();

    await byName.draft_email_reply.handler({ message_id: "m3", body_html: "<p>r</p>" }, {});

    expect(createDraft.mock.calls[0][0].replyToMessageId).toBe("m3");
    expect(createDraft.mock.calls[0][0].subject).toBe("Re: Hello");
  });
});

/**
 * The volume limit, exercised THROUGH the tool.
 *
 * outbound-limits.test.ts proves the arithmetic. This proves send_email_draft
 * actually consults it — which is the part that failed on 2026-08-20, where
 * every individual send was correct and the total was the problem.
 */
describe("send_email_draft volume limit", () => {
  it("refuses an autonomous send once the hourly cap is reached", async () => {
    getDraft.mockResolvedValue(draftWith(["rahul@aixccelerate.com"]));
    // 3 already sent this hour, and this run is autonomous.
    const { db, audits } = fakeDb([], 3);
    const list = buildNylasEmailTools({
      orgId: "org-1",
      userId: null,
      sessionId: null,
      emailSendPolicy: "internal_only",
      db,
    });
    const send = list.find((t) => t.name === "send_email_draft")!;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (send as any).handler({ draft_id: "d1" }, {});

    expect(res.isError).toBe(true);
    expect(sendDraft).not.toHaveBeenCalled();
    expect(res.content[0].text).toContain("limit");
    // Refusing must not lose the work.
    expect(res.content[0].text).toContain("draft is saved");
    expect(audits.some((a) => a.action === "email.send_blocked")).toBe(true);
  });

  it("still sends an internal draft when under the cap", async () => {
    getDraft.mockResolvedValue(draftWith(["rahul@aixccelerate.com"]));
    const { db } = fakeDb([], 1);
    const list = buildNylasEmailTools({
      orgId: "org-1",
      userId: null,
      sessionId: null,
      emailSendPolicy: "internal_only",
      db,
    });
    const send = list.find((t) => t.name === "send_email_draft")!;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (send as any).handler({ draft_id: "d1" }, {});

    expect(res.isError).toBeFalsy();
    expect(sendDraft).toHaveBeenCalled();
  });

  it("does not apply the autonomous cap to a human in chat", async () => {
    // Same count that blocks an autonomous run must not block a person.
    getDraft.mockResolvedValue(draftWith(["rahul@aixccelerate.com"]));
    const { db } = fakeDb([], 3);
    const list = buildNylasEmailTools({
      orgId: "org-1",
      userId: null,
      sessionId: null,
      db,
    });
    const send = list.find((t) => t.name === "send_email_draft")!;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (send as any).handler({ draft_id: "d1" }, {});

    expect(res.isError).toBeFalsy();
    expect(sendDraft).toHaveBeenCalled();
  });

  it("checks the limit BEFORE reading the draft, so a capped run is cheap", async () => {
    const { db } = fakeDb([], 99);
    const list = buildNylasEmailTools({
      orgId: "org-1",
      userId: null,
      sessionId: null,
      emailSendPolicy: "internal_only",
      db,
    });
    const send = list.find((t) => t.name === "send_email_draft")!;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (send as any).handler({ draft_id: "d1" }, {});

    expect(getDraft).not.toHaveBeenCalled();
  });
});
