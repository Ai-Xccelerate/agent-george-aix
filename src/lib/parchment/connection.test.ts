/**
 * Resolving an org's Parchment knowledge base on the internal agent path.
 *
 * The rules under test are tenancy rules, and getting them wrong would be
 * serious: the org is identified purely by its Clerk org id, so a missing or
 * wrong one must fail loudly rather than fall back to some other org's
 * knowledge. There is deliberately no credential to test here — the internal
 * path replaced the per-org API key with one deployment-level shared secret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeFailure, getParchmentStatus, resolveParchmentConfig } from "./connection";

const VARS = [
  "PARCHMENT_API_URL",
  "PARCHMENT_API_BASE",
  "PARCHMENT_INTERNAL_AGENT_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

const CLERK_ORG = "org_3DAfHZvqPP1jys65q7D7d9y79eD";

/**
 * Stand-in for the admin client. Two tables are read — `integrations` for the
 * preference row and `orgs` for the Clerk id — so the fake dispatches on table.
 */
function fakeDb(opts: { integration?: unknown; clerkOrgId?: string | null }): SupabaseClient {
  return {
    from(table: string) {
      const row =
        table === "integrations"
          ? (opts.integration ?? null)
          : table === "orgs"
            ? opts.clerkOrgId === undefined
              ? { clerk_org_id: CLERK_ORG }
              : { clerk_org_id: opts.clerkOrgId }
            : null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error: null }),
        upsert: async () => ({ error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  for (const k of VARS) saved[k] = process.env[k];
  delete process.env.PARCHMENT_API_BASE;
  process.env.PARCHMENT_API_URL = "https://parchment.example.test";
  process.env.PARCHMENT_INTERNAL_AGENT_KEY = "internal-secret";
});

afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveParchmentConfig", () => {
  it("resolves using the org's Clerk id, with no stored credential", async () => {
    const res = await resolveParchmentConfig(fakeDb({}), "org-uuid");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config).toEqual({
        base: "https://parchment.example.test",
        internalKey: "internal-secret",
        clerkOrgId: CLERK_ORG,
        workspaceId: null,
      });
    }
  });

  it("is available by default — an org with no integrations row still resolves", async () => {
    // The whole point of the internal path: no setup step, no opt-in.
    const res = await resolveParchmentConfig(fakeDb({ integration: null }), "org-uuid");
    expect(res.ok).toBe(true);
  });

  it("passes a chosen workspace through", async () => {
    const res = await resolveParchmentConfig(
      fakeDb({ integration: { id: "r", status: "connected", metadata: { workspace_id: "ws-2" } } }),
      "org-uuid",
    );
    expect(res.ok && res.config.workspaceId).toBe("ws-2");
  });

  it("honours the opt-out", async () => {
    const res = await resolveParchmentConfig(
      fakeDb({ integration: { id: "r", status: "disconnected", metadata: { enabled: false } } }),
      "org-uuid",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.reason).toBe("opted_out");
  });

  it("refuses when the org has no Clerk org id, rather than guessing", async () => {
    // Parchment has no other way to identify the tenant. Proceeding would either
    // 401 or, worse, resolve to the wrong organisation.
    const res = await resolveParchmentConfig(fakeDb({ clerkOrgId: null }), "org-uuid");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.reason).toBe("no_clerk_org");
  });

  it("treats half-configuration as off and names what is missing", async () => {
    delete process.env.PARCHMENT_INTERNAL_AGENT_KEY;
    const res = await resolveParchmentConfig(fakeDb({}), "org-uuid");
    expect(res.ok).toBe(false);
    if (!res.ok && res.failure.reason === "not_configured") {
      expect(res.failure.missing).toEqual(["PARCHMENT_INTERNAL_AGENT_KEY"]);
    } else {
      throw new Error("expected not_configured");
    }
  });

  it("accepts PARCHMENT_API_BASE as a legacy alias for the URL", async () => {
    delete process.env.PARCHMENT_API_URL;
    process.env.PARCHMENT_API_BASE = "https://legacy.example.test";
    const res = await resolveParchmentConfig(fakeDb({}), "org-uuid");
    expect(res.ok && res.config.base).toBe("https://legacy.example.test");
  });
});

describe("getParchmentStatus", () => {
  function mockFetch(handler: (url: string) => { status?: number; json: unknown }) {
    const spy = vi.fn(async (url: URL) => {
      const { status = 200, json } = handler(String(url));
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
        text: async () => JSON.stringify(json),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("reports the live workspace list and document count", async () => {
    mockFetch((url) =>
      url.includes("/workspaces/resolve")
        ? {
            json: {
              org_id: "p-org",
              default_workspace_id: "ws-1",
              workspaces: [{ id: "ws-1", name: "General", visibility: "org" }],
            },
          }
        : // Verified against staging: documents comes back wrapped, not bare.
          { json: { documents: [{ source_file: "a.md" }, { source_file: "b.md" }] } },
    );

    const status = await getParchmentStatus(fakeDb({}), "org-uuid");

    expect(status.active).toBe(true);
    expect(status.reachable).toBe(true);
    expect(status.workspaces).toHaveLength(1);
    expect(status.defaultWorkspaceId).toBe("ws-1");
    expect(status.documents).toBe(2);
  });

  it("sends the three internal headers, not a bearer token", async () => {
    const spy = mockFetch(() => ({
      json: { org_id: "p", default_workspace_id: "ws-1", workspaces: [] },
    }));

    await getParchmentStatus(fakeDb({}), "org-uuid");

    const [, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Internal-Key"]).toBe("internal-secret");
    expect(headers.Authorization).toBeUndefined();
  });

  it("stays usable when Parchment is unreachable", async () => {
    mockFetch(() => ({ status: 503, json: { detail: "down" } }));

    const status = await getParchmentStatus(fakeDb({}), "org-uuid");

    // Active but unreachable is a real, distinct state: George falls back to
    // local knowledge and the admin sees why.
    expect(status.active).toBe(true);
    expect(status.reachable).toBe(false);
    expect(status.error).toMatch(/unavailable/i);
  });

  it("falls back to the last known workspaces when a resolve fails", async () => {
    mockFetch(() => ({ status: 503, json: {} }));

    const status = await getParchmentStatus(
      fakeDb({
        integration: {
          id: "r",
          status: "connected",
          metadata: {
            known_workspaces: [{ id: "ws-1", name: "General", visibility: "org" }],
            default_workspace_id: "ws-1",
          },
        },
      }),
      "org-uuid",
    );

    // So the picker is not empty just because Parchment blipped.
    expect(status.workspaces).toHaveLength(1);
  });
});

describe("describeFailure", () => {
  it("explains each reason in terms an admin can act on", () => {
    expect(describeFailure({ reason: "not_configured", missing: ["PARCHMENT_API_URL"] })).toMatch(
      /PARCHMENT_API_URL/,
    );
    expect(describeFailure({ reason: "opted_out" })).toMatch(/switched off/i);
    expect(describeFailure({ reason: "no_clerk_org" })).toMatch(/Clerk/);
  });
});
