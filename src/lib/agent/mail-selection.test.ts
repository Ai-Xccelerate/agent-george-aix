/**
 * Deleting a credential must never change providers. It must disable the
 * provider.
 *
 * The old rule was `isNylasEnabled() ? nylasTools : composioTools`, where
 * "enabled" meant the Nylas variables were merely PRESENT. So removing one did
 * not switch George's mailbox off — it silently switched George onto Composio, a
 * different mailbox belonging to a person, with its own live OAuth connection.
 *
 * That nearly happened for real. After the 20 August incident the Nylas key was
 * replaced with a placeholder rather than deleted, purely because deleting it
 * would have armed Composio. A placeholder holding a safe shut is not a control.
 *
 * The first test in each group is the one that matters: a missing credential
 * produces NO mailbox, never the other one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mailDisabled, mailSelection, usingComposio, usingNylas } from "./mail-selection";

const KEYS = [
  "MAIL_PROVIDER",
  "NYLAS_API_KEY",
  "NYLAS_GRANT_ID",
  "COMPOSIO_API_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

function nylasCredentials() {
  process.env.NYLAS_API_KEY = "nyk_v0_real";
  process.env.NYLAS_GRANT_ID = "grant-1";
}
function composioCredentials() {
  process.env.COMPOSIO_API_KEY = "comp_real";
}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("a missing credential disables the provider", () => {
  it("does NOT fall through to Composio when Nylas is chosen but unconfigured", async () => {
    // The exact scenario the placeholder was protecting against.
    process.env.MAIL_PROVIDER = "nylas";
    composioCredentials(); // Composio is fully available, and must not be used.

    expect(usingNylas()).toBe(false);
    expect(usingComposio()).toBe(false);
    expect(mailDisabled()).toBe(true);
  });

  it("says why, rather than failing silently", async () => {
    process.env.MAIL_PROVIDER = "nylas";
    const s = mailSelection();
    expect(s.problem).toContain("credentials are missing");
    // And states the non-obvious part explicitly.
    expect(s.problem).toContain("does NOT fall back");
  });

  it("does not fall through to Nylas either, in the other direction", async () => {
    process.env.MAIL_PROVIDER = "composio";
    nylasCredentials();

    expect(usingComposio()).toBe(false);
    expect(usingNylas()).toBe(false);
    expect(mailDisabled()).toBe(true);
  });
});

describe("an explicit choice is honoured", () => {
  it("uses Nylas when chosen and configured", () => {
    process.env.MAIL_PROVIDER = "nylas";
    nylasCredentials();
    expect(usingNylas()).toBe(true);
    expect(mailSelection().source).toBe("explicit");
  });

  it("uses Composio when chosen, even though Nylas is also configured", () => {
    // Presence no longer wins. The stated choice does.
    process.env.MAIL_PROVIDER = "composio";
    nylasCredentials();
    composioCredentials();
    expect(usingComposio()).toBe(true);
    expect(usingNylas()).toBe(false);
  });

  it("supports turning mail off outright", () => {
    process.env.MAIL_PROVIDER = "none";
    nylasCredentials();
    composioCredentials();
    expect(mailDisabled()).toBe(true);
    expect(mailSelection().problem).toBeNull();
  });

  it("ignores casing and stray whitespace", () => {
    process.env.MAIL_PROVIDER = "  Nylas  ";
    nylasCredentials();
    expect(usingNylas()).toBe(true);
  });

  it("treats an unrecognised value as unset rather than as a mailbox", () => {
    process.env.MAIL_PROVIDER = "outlook";
    nylasCredentials();
    const s = mailSelection();
    expect(s.source).toBe("inferred");
    expect(s.provider).toBe("nylas");
  });
});

describe("unset keeps today's behaviour, and admits it", () => {
  it("still infers, so deploying this does not take mail away", () => {
    nylasCredentials();
    const s = mailSelection();
    expect(s.provider).toBe("nylas");
    expect(s.source).toBe("inferred");
  });

  it("infers Composio when only Composio is configured", () => {
    composioCredentials();
    const s = mailSelection();
    expect(s.provider).toBe("composio");
    expect(s.source).toBe("inferred");
  });

  it("reports none when nothing is configured", () => {
    const s = mailSelection();
    expect(s.provider).toBe("none");
    expect(mailDisabled()).toBe(true);
    expect(s.problem).toContain("MAIL_PROVIDER is unset");
  });

  it("inference is the ONLY path that can pick a provider by itself", () => {
    // Set the variable and the fallback can never run again — which is the
    // property that makes deleting a credential safe.
    process.env.MAIL_PROVIDER = "nylas";
    composioCredentials();
    expect(mailSelection().source).toBe("explicit");
    expect(usingComposio()).toBe(false);
  });
});
