/**
 * Parchment client contract tests.
 *
 * What matters here is not "does fetch work" but the promises this client makes
 * to callers sitting on the chat path: it never throws, it sends the internal
 * agent credential rather than a bearer token, it scopes every call to one org,
 * and it turns Parchment's documented status codes into something an operator can
 * act on. All with fetch mocked, so CI needs no instance and no secret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_ID,
  createParchmentClient,
  documentCount,
  isParchmentConfigured,
  parchmentDeployment,
  parchmentMissingVars,
  toKnowledgeHits,
  type ParchmentConfig,
  type ParchmentQueryResult,
} from "./client";

const CFG: ParchmentConfig = {
  base: "https://parchment.example.test",
  internalKey: "internal-secret",
  clerkOrgId: "org_abc123",
};

const VARS = ["PARCHMENT_API_URL", "PARCHMENT_API_BASE", "PARCHMENT_INTERNAL_AGENT_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  reject?: Error;
}) {
  const spy = vi.fn(async () => {
    if (response.reject) throw response.reject;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json,
      text: async () => response.text ?? "",
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
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

describe("deployment configuration", () => {
  it("requires both the URL and the shared secret", () => {
    expect(isParchmentConfigured()).toBe(true);

    delete process.env.PARCHMENT_INTERNAL_AGENT_KEY;
    expect(isParchmentConfigured()).toBe(false);
    expect(parchmentMissingVars()).toEqual(["PARCHMENT_INTERNAL_AGENT_KEY"]);
  });

  it("trims a trailing slash so paths never double up", () => {
    process.env.PARCHMENT_API_URL = "https://parchment.example.test/";
    expect(parchmentDeployment()?.base).toBe("https://parchment.example.test");
  });
});

describe("auth headers", () => {
  it("sends the three internal headers instead of a bearer token", async () => {
    const spy = mockFetch({ json: { query: "x", count: 0, results: [] } });

    await createParchmentClient(CFG).query({ query: "refund policy" });

    const [, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Internal-Key"]).toBe("internal-secret");
    expect(headers["X-Clerk-Org-Id"]).toBe("org_abc123");
    expect(headers["X-Agent-Id"]).toBe(AGENT_ID);
    // The internal path does not use bearer auth at all.
    expect(headers.Authorization).toBeUndefined();
  });

  it("omits X-Workspace-Id unless a workspace was chosen", async () => {
    const spy = mockFetch({ json: {} });

    await createParchmentClient(CFG).documents();
    let headers = (spy.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Record<
      string,
      string
    >;
    // Absent means "the org's default", which is what most orgs want.
    expect(headers["X-Workspace-Id"]).toBeUndefined();

    await createParchmentClient({ ...CFG, workspaceId: "ws-9" }).documents();
    headers = (spy.mock.calls[1] as unknown as [URL, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect(headers["X-Workspace-Id"]).toBe("ws-9");
  });

  it("scopes each client to its own org", async () => {
    const spy = mockFetch({ json: {} });

    await createParchmentClient({ ...CFG, clerkOrgId: "org_a" }).documents();
    await createParchmentClient({ ...CFG, clerkOrgId: "org_b" }).documents();

    const orgs = spy.mock.calls.map(
      (c) => ((c as unknown as [URL, RequestInit])[1].headers as Record<string, string>)["X-Clerk-Org-Id"],
    );
    expect(orgs).toEqual(["org_a", "org_b"]);
  });

  it("does not send tenant headers on health, so it works before an org exists", async () => {
    const spy = mockFetch({ json: { status: "ok" } });

    await createParchmentClient(CFG).health();

    const headers = (spy.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect(headers["X-Internal-Key"]).toBe("internal-secret");
    expect(headers["X-Clerk-Org-Id"]).toBeUndefined();
  });
});

describe("workspace resolution", () => {
  it("puts the org id in the path and posts the agent id", async () => {
    const spy = mockFetch({
      json: { org_id: "p", default_workspace_id: "ws-1", workspaces: [] },
    });

    await createParchmentClient(CFG).resolveWorkspaces();

    const [url, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      "https://parchment.example.test/internal/orgs/org_abc123/workspaces/resolve",
    );
    expect(JSON.parse(init.body as string)).toEqual({ agent_id: "george" });
  });

  it("url-encodes the org id so it cannot break out of the path", async () => {
    const spy = mockFetch({ json: {} });
    await createParchmentClient({ ...CFG, clerkOrgId: "../../admin" }).resolveWorkspaces();
    const [url] = spy.mock.calls[0] as unknown as [URL];
    expect(String(url)).toContain("%2F");
    expect(String(url)).not.toContain("/../");
  });
});

describe("request shape", () => {
  it("clamps limit to Parchment's documented 1..50", async () => {
    const spy = mockFetch({ json: { query: "x", count: 0, results: [] } });
    const client = createParchmentClient(CFG);

    await client.query({ query: "a", limit: 999 });
    expect(
      JSON.parse((spy.mock.calls[0] as unknown as [URL, RequestInit])[1].body as string).limit,
    ).toBe(50);

    await client.query({ query: "a", limit: 0 });
    expect(
      JSON.parse((spy.mock.calls[1] as unknown as [URL, RequestInit])[1].body as string).limit,
    ).toBe(1);
  });
});

describe("failure handling — never throws, always explains", () => {
  it.each([
    [401, /PARCHMENT_INTERNAL_AGENT_KEY|Clerk organization id/i],
    [403, /not enabled|above 'agent'/i],
    [429, /rate limited/i],
    [503, /unavailable/i],
  ])("translates %i into an actionable message", async (status, pattern) => {
    mockFetch({ ok: false, status, text: "upstream detail" });

    const res = await createParchmentClient(CFG).query({ query: "a" });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(status);
      expect(res.error).toMatch(pattern);
    }
  });

  it("explains that 403 can mean the credential cannot write", async () => {
    // Verified against staging: /ingest returns 403 "Requires editor role;
    // credential has agent". An operator needs to know that is expected.
    mockFetch({ ok: false, status: 403, text: "Requires editor role; credential has agent" });
    const res = await createParchmentClient(CFG).query({ query: "a" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/read-and-propose only|cannot ingest/i);
  });

  it("resolves rather than rejecting when the network fails", async () => {
    mockFetch({ reject: new Error("ECONNREFUSED") });

    // A throw here would break the chat turn instead of degrading the answer.
    const res = await createParchmentClient(CFG).query({ query: "a" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Could not reach Parchment/);
  });

  it("reports a timeout as a timeout", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    mockFetch({ reject: abort });

    const res = await createParchmentClient(CFG).query({ query: "a" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/did not respond within \d+s/);
  });
});

describe("documentCount", () => {
  it("handles the wrapped shape staging actually returns", () => {
    expect(documentCount({ documents: [{ source_file: "a" }, { source_file: "b" }] })).toBe(2);
    expect(documentCount({ documents: [] })).toBe(0);
  });

  it("also handles a bare array, as the public REST doc reads", () => {
    expect(documentCount([{ source_file: "a" }])).toBe(1);
  });

  it("returns null for an unexpected shape rather than pretending it is zero", () => {
    // Zero and "I don't know" are different things to show an admin.
    expect(documentCount(undefined)).toBeNull();
    expect(documentCount({} as never)).toBeNull();
  });
});

describe("toKnowledgeHits", () => {
  const result: ParchmentQueryResult = {
    query: "refund policy",
    count: 1,
    results: [
      {
        section_id: "sec-1",
        source_file: "policies.md",
        hierarchy_path: "Company > Support > Returns",
        h_level: 3,
        title: "Returns",
        content: "Refunds within 30 days.",
        score: 0.4212345,
        business_function: "Customer Success",
        ancestors: [
          { section_id: "a1", title: "Company", hierarchy_path: "Company", content: "..." },
          { section_id: "a2", title: "Support", hierarchy_path: "Company > Support", content: "..." },
        ],
      },
    ],
  };

  it("maps a section onto the shape search_knowledge already returns", () => {
    const [hit] = toKnowledgeHits(result);
    expect(hit.path).toBe("policies.md");
    expect(hit.snippet).toBe("Refunds within 30 days.");
    expect(hit.score).toBe(0.4212);
    // Provenance is the point: chunk search could never say where this came from.
    expect(hit.hierarchy_path).toBe("Company > Support > Returns");
    expect(hit.section_id).toBe("sec-1");
  });

  it("summarises ancestors as a trail instead of flooding the context", () => {
    expect(toKnowledgeHits(result)[0].context).toBe("Company > Support");
  });

  it("marks Parchment hits as non-core, since core stays in the repo", () => {
    expect(toKnowledgeHits(result)[0].is_core).toBe(false);
  });

  it("tolerates an empty or missing results array", () => {
    expect(toKnowledgeHits({ ...result, results: [] })).toEqual([]);
    expect(toKnowledgeHits({ query: "x", count: 0 } as ParchmentQueryResult)).toEqual([]);
  });
});
