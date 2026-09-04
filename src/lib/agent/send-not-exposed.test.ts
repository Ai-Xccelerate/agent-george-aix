/**
 * The send path is built, guarded, and unreachable. This is the check that the
 * third part is true.
 *
 * WHY THIS TEST EXISTS AT ALL
 * AGENTS.md: "a verification that cannot report failure is not a verification",
 * and the sibling warning about `email.send_blocked` sitting at zero for all
 * time and being read as "nothing to refuse". "Sending is switched off" is
 * exactly the kind of claim that rots quietly — the flag is one line, the tool
 * list is one line, and nothing else in the app would notice if they drifted
 * apart. On 20 August the drift went the other way (tool registered, prose said
 * don't) and 16 emails went out.
 *
 * So the assertion is about the TOOL LIST, not about a policy object. The list
 * is what the model receives; anything else is a description of intent.
 *
 * IT FAILS ON PURPOSE, BOTH WAYS
 * The last block flips the flag's effect and asserts the tool comes back. If
 * the registration were hard-deleted rather than gated, that block fails — so
 * this cannot pass by the path being gone, only by it being present and
 * withheld. And if someone un-gates the registration, the first block fails.
 */
import { describe, expect, it, vi } from "vitest";
import { EMAIL_SENDING_EXPOSED } from "@/lib/features";

// Nylas has to look configured, or the tools short-circuit and the test would
// pass for the wrong reason: an empty list because there is no mailbox, read as
// an empty list because sending is off.
vi.mock("@/lib/nylas/client", () => ({
  nylasConfig: () => ({
    apiKey: "test-key",
    apiUrl: "https://api.nylas.test",
    grantId: "grant-test",
    fromEmail: "george@example.test",
    fromName: "George",
  }),
  createNylasClient: () => ({}),
}));

const ctx = {
  orgId: "00000000-0000-0000-0000-000000000001",
  userId: null,
  sessionId: null,
  db: {} as never,
};

async function nylasToolNames(): Promise<string[]> {
  const { buildNylasEmailTools } = await import("@/lib/agent/nylas-tools");
  return buildNylasEmailTools(ctx).map((t) => t.name);
}

describe("email sending is not exposed to George", () => {
  it("is switched off in this build", () => {
    // If this ever needs changing, it is a product decision and not a test fix.
    expect(EMAIL_SENDING_EXPOSED).toBe(false);
  });

  it("does not register send_email_draft", async () => {
    const names = await nylasToolNames();
    expect(names).not.toContain("send_email_draft");
  });

  it("still registers drafting, so George can prepare mail a human sends", async () => {
    // The point of "not exposed" rather than "removed": George keeps writing
    // the email, and a person sends it from the mailbox Drafts folder.
    const names = await nylasToolNames();
    expect(names).toContain("draft_email");
    expect(names).toContain("draft_email_reply");
  });

  it("keeps the guarded send path in the codebase, not just the tool", async () => {
    // The guards are the expensive, security-relevant part. Disabling the tool
    // must not quietly take them out of the build.
    const mod = await import("@/lib/agent/send-guarded");
    expect(typeof mod.sendDraftGuarded).toBe("function");
  });

  it("registers send_email_draft again when the flag is flipped", async () => {
    // Proves the registration is GATED and not deleted. Without this the suite
    // would pass just as happily against a codebase that had ripped the send
    // path out — which is the opposite of what was asked for.
    vi.resetModules();
    vi.doMock("@/lib/features", () => ({
      EMAIL_SENDING_EXPOSED: true,
      AI_ACTIONS_QUEUE_ENABLED: false,
    }));
    try {
      const names = await nylasToolNames();
      expect(names).toContain("send_email_draft");
    } finally {
      vi.doUnmock("@/lib/features");
      vi.resetModules();
    }
  });
});
