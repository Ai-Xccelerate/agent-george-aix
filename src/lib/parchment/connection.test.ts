/**
 * Per-org connection resolution.
 *
 * The rule under test is a tenancy rule, and getting it wrong would be serious:
 * an org that connected its own hub must never be served a different one. The
 * dangerous case is subtle — a stored row that cannot be decrypted must resolve
 * to "nothing connected", NOT fall through to the deployment default, because
 * that default may belong to another organisation entirely.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seal } from "@/lib/crypto/secret-box";
import { getParchmentConnection, resolveParchmentConfig } from "./connection";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

/** Minimal stand-in for the admin client's `.from().select().eq().eq().maybeSingle()`. */
function fakeDb(row: unknown): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

const saved: Record<string, string | undefined> = {};
const VARS = ["APP_ENCRYPTION_KEY", "PARCHMENT_API_BASE", "PARCHMENT_API_KEY"] as const;

beforeEach(() => {
  for (const k of VARS) saved[k] = process.env[k];
  process.env.APP_ENCRYPTION_KEY = KEY_A;
  delete process.env.PARCHMENT_API_BASE;
  delete process.env.PARCHMENT_API_KEY;
});

afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function connectedRow(base = "https://org-a.parchment.test", key = "pcm_org_a") {
  return {
    id: "row-1",
    status: "connected",
    account_label: "org-a.parchment.test",
    metadata: {
      base_url: base,
      key: seal(key),
      key_fingerprint: "pcm_or…rg_a",
      documents: 12,
      last_checked_at: "2026-08-12T10:00:00.000Z",
      connected_by: "vidhi@aixccelerate.com",
    },
    updated_at: "2026-08-12T10:00:00.000Z",
  };
}

describe("resolveParchmentConfig", () => {
  it("uses the org's own stored connection", async () => {
    const cfg = await resolveParchmentConfig(fakeDb(connectedRow()), "org-a");
    expect(cfg).toEqual({ base: "https://org-a.parchment.test", apiKey: "pcm_org_a" });
  });

  it("strips a trailing slash from the stored base", async () => {
    const row = connectedRow("https://org-a.parchment.test/");
    const cfg = await resolveParchmentConfig(fakeDb(row), "org-a");
    expect(cfg?.base).toBe("https://org-a.parchment.test");
  });

  it("falls back to the environment default when the org has no row", async () => {
    process.env.PARCHMENT_API_BASE = "https://deployment-default.test";
    process.env.PARCHMENT_API_KEY = "pcm_default";

    const cfg = await resolveParchmentConfig(fakeDb(null), "org-with-no-row");

    expect(cfg).toEqual({ base: "https://deployment-default.test", apiKey: "pcm_default" });
  });

  it("returns nothing when neither a row nor an environment default exists", async () => {
    expect(await resolveParchmentConfig(fakeDb(null), "org-a")).toBeNull();
  });

  it("treats a disconnected row as no connection, ignoring the environment", async () => {
    process.env.PARCHMENT_API_BASE = "https://deployment-default.test";
    process.env.PARCHMENT_API_KEY = "pcm_default";
    const row = { ...connectedRow(), status: "disconnected" };

    // Someone clicked Disconnect. Silently reverting them to a shared default
    // would be the opposite of what they asked for.
    expect(await resolveParchmentConfig(fakeDb(row), "org-a")).toBeNull();
  });

  it("does NOT fall back to the environment when the stored key cannot be decrypted", async () => {
    const row = connectedRow();
    process.env.PARCHMENT_API_BASE = "https://deployment-default.test";
    process.env.PARCHMENT_API_KEY = "pcm_default";
    // Simulate a rotated APP_ENCRYPTION_KEY.
    process.env.APP_ENCRYPTION_KEY = KEY_B;

    const cfg = await resolveParchmentConfig(fakeDb(row), "org-a");

    // The tenancy rule: this org chose a hub. If we cannot read that choice we
    // serve nothing, rather than querying a workspace it never connected.
    expect(cfg).toBeNull();
  });
});

describe("getParchmentConnection", () => {
  it("reports an org connection without exposing the key", async () => {
    const conn = await getParchmentConnection(fakeDb(connectedRow()), "org-a");

    expect(conn.connected).toBe(true);
    expect(conn.source).toBe("org");
    expect(conn.baseUrl).toBe("https://org-a.parchment.test");
    expect(conn.documents).toBe(12);
    expect(conn.connectedBy).toBe("vidhi@aixccelerate.com");
    // No plaintext secret anywhere in what the UI receives.
    expect(JSON.stringify(conn)).not.toContain("pcm_org_a");
  });

  it("labels a deployment-wide default as coming from the environment", async () => {
    process.env.PARCHMENT_API_BASE = "https://deployment-default.test";
    process.env.PARCHMENT_API_KEY = "pcm_default_key_1234";

    const conn = await getParchmentConnection(fakeDb(null), "org-a");

    expect(conn.source).toBe("environment");
    expect(conn.connected).toBe(true);
    // Fingerprint only — the admin can identify it without seeing it.
    expect(conn.keyFingerprint).toBe("pcm_de…1234");
    expect(JSON.stringify(conn)).not.toContain("pcm_default_key_1234");
  });

  it("reports nothing connected when there is no row and no default", async () => {
    const conn = await getParchmentConnection(fakeDb(null), "org-a");
    expect(conn).toMatchObject({ connected: false, source: "none", baseUrl: null });
  });

  it("surfaces the stored error from a failed check", async () => {
    const row = connectedRow();
    row.status = "error";
    (row.metadata as Record<string, unknown>).last_error = "Parchment rejected the API key (401)";

    const conn = await getParchmentConnection(fakeDb(row), "org-a");

    expect(conn.connected).toBe(false);
    expect(conn.status).toBe("error");
    expect(conn.lastError).toMatch(/401/);
  });
});
