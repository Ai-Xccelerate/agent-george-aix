/**
 * What the UI says about George's note-taker.
 *
 * This label was hardcoded to an address at a company the deployment no longer
 * belongs to. Making it configurable then left it blank when unset, which was
 * worse: the Identity row renders `account ?? "Not connected"`, so a working
 * integration reported itself as disconnected right next to a green pill.
 *
 * It is now derived from the token, which is the only honest source available —
 * Scribe's MCP has no whoami. And the distinction it exposes matters: a
 * user-scoped key silently limits George to whoever minted it, which surfaces
 * months later as "some meetings are missing".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getScribeConnection, scribeAccountLabel, scribeTokenScope } from "./scribe";

const saved = {
  url: process.env.SCRIBE_MCP_URL,
  token: process.env.SCRIBE_MCP_TOKEN,
  account: process.env.SCRIBE_ACCOUNT_EMAIL,
};

beforeEach(() => {
  process.env.SCRIBE_MCP_URL = "https://api-scribe.example/api/mcp";
  process.env.SCRIBE_MCP_TOKEN = "sk_scribe_org_abc123";
  delete process.env.SCRIBE_ACCOUNT_EMAIL;
});

afterEach(() => {
  for (const [k, v] of [
    ["SCRIBE_MCP_URL", saved.url],
    ["SCRIBE_MCP_TOKEN", saved.token],
    ["SCRIBE_ACCOUNT_EMAIL", saved.account],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("the token tells us its own reach", () => {
  it("recognises an org-scoped key", () => {
    expect(scribeTokenScope()).toBe("org");
    expect(scribeAccountLabel()).toBe("Every meeting in the workspace");
  });

  it("recognises a user-scoped key and warns what it costs", () => {
    // The failure this prevents: George quietly seeing one person's calendar
    // and nobody noticing until meetings are missing.
    process.env.SCRIBE_MCP_TOKEN = "sk_scribe_xyz789";
    expect(scribeTokenScope()).toBe("user");
    expect(scribeAccountLabel()).toContain("One member's meetings only");
    expect(scribeAccountLabel()).toContain("org-scoped");
  });

  it("does not guess at an unfamiliar token shape", () => {
    process.env.SCRIBE_MCP_TOKEN = "something-else";
    expect(scribeTokenScope()).toBe("unknown");
  });

  it("checks the org prefix before the user prefix", () => {
    // "sk_scribe_org_…" also starts with "sk_scribe_", so order matters.
    process.env.SCRIBE_MCP_TOKEN = "sk_scribe_org_ordering";
    expect(scribeTokenScope()).not.toBe("user");
  });
});

describe("an explicit account wins", () => {
  it("uses SCRIBE_ACCOUNT_EMAIL when a deployment knows the mailbox", () => {
    process.env.SCRIBE_ACCOUNT_EMAIL = "notetaker@acmecorp.com";
    expect(scribeAccountLabel()).toBe("notetaker@acmecorp.com");
  });

  it("names no company by default", () => {
    // The whole reason this changed: it used to assert an address at a company
    // this deployment has nothing to do with.
    expect(scribeAccountLabel()).not.toContain("@");
  });
});

describe("the label never contradicts the connection", () => {
  it("always gives a connected integration something to show", () => {
    // `account ?? "Not connected"` in the Identity row meant a null here
    // rendered as disconnected beside a green pill.
    const c = getScribeConnection();
    expect(c.connected).toBe(true);
    expect(c.account).toBeTruthy();
  });

  it("still says nothing when Scribe is genuinely not configured", () => {
    delete process.env.SCRIBE_MCP_TOKEN;
    const c = getScribeConnection();
    expect(c.connected).toBe(false);
    expect(c.account).toBeNull();
  });

  it("falls back to a plain label rather than blank on an odd token", () => {
    process.env.SCRIBE_MCP_TOKEN = "legacy-token-format";
    const c = getScribeConnection();
    expect(c.connected).toBe(true);
    expect(c.account).toBe("Connected");
  });
});
