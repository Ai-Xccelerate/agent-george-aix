/**
 * Parchment client contract tests.
 *
 * The behaviour that matters here is not "does fetch work" but the promises this
 * client makes to its callers, which sit on the chat path: it never throws, it
 * treats half-configuration as off, and it turns Parchment's documented status
 * codes into something an operator can act on. All of it runs with fetch mocked,
 * so CI needs no instance and no API key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isParchmentEnabled,
  parchment,
  parchmentConfig,
  parchmentMissingVars,
  toKnowledgeHits,
  type ParchmentQueryResult,
} from "./client";

const saved: Record<string, string | undefined> = {};
const VARS = ["PARCHMENT_API_BASE", "PARCHMENT_API_KEY"] as const;

function configured() {
  process.env.PARCHMENT_API_BASE = "https://parchment.example.test";
  process.env.PARCHMENT_API_KEY = "pcm_test_key";
}

/** Stand in for fetch, capturing the request so the call shape can be asserted. */
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
  configured();
});

afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("configuration", () => {
  it("is enabled only when both variables are present", () => {
    expect(isParchmentEnabled()).toBe(true);

    delete process.env.PARCHMENT_API_KEY;
    expect(isParchmentEnabled()).toBe(false);
    expect(parchmentMissingVars()).toEqual(["PARCHMENT_API_KEY"]);

    delete process.env.PARCHMENT_API_BASE;
    expect(parchmentMissingVars()).toEqual(["PARCHMENT_API_BASE", "PARCHMENT_API_KEY"]);
  });

  it("trims a trailing slash from the base so paths never double up", () => {
    process.env.PARCHMENT_API_BASE = "https://parchment.example.test/";
    expect(parchmentConfig()?.base).toBe("https://parchment.example.test");
  });

  it("returns a clear error instead of calling out when unconfigured", async () => {
    delete process.env.PARCHMENT_API_KEY;
    const spy = mockFetch({ json: {} });

    const res = await parchment.query({ query: "refund policy" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not configured/i);
    // The important half: no request was attempted.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("request shape", () => {
  it("sends the bearer token and the documented query body", async () => {
    const spy = mockFetch({ json: { query: "x", count: 0, results: [] } });

    await parchment.query({ query: "refund policy", limit: 3, iterative: true });

    const [url, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://parchment.example.test/query");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pcm_test_key");
    expect(JSON.parse(init.body as string)).toEqual({
      query: "refund policy",
      limit: 3,
      business_function: null,
      business_objective: null,
      iterative: true,
    });
  });

  it("clamps limit to Parchment's documented 1..50", async () => {
    const spy = mockFetch({ json: { query: "x", count: 0, results: [] } });

    await parchment.query({ query: "a", limit: 999 });
    expect(JSON.parse((spy.mock.calls[0] as unknown as [URL, RequestInit])[1].body as string).limit).toBe(50);

    await parchment.query({ query: "a", limit: 0 });
    expect(JSON.parse((spy.mock.calls[1] as unknown as [URL, RequestInit])[1].body as string).limit).toBe(1);
  });

  it("url-encodes ids so a section id can never break out of the path", async () => {
    const spy = mockFetch({ json: {} });
    await parchment.section("../../admin?x=1");
    const [url] = spy.mock.calls[0] as unknown as [URL];
    expect(String(url)).toContain("%2F");
    expect(String(url)).not.toContain("/../");
  });

  it("drops empty query params rather than sending blanks", async () => {
    const spy = mockFetch({ json: [] });
    await parchment.sections({ business_function: undefined, limit: 10 });
    const [url] = spy.mock.calls[0] as unknown as [URL];
    expect(String(url)).toBe("https://parchment.example.test/sections?limit=10");
  });
});

describe("failure handling — never throws, always explains", () => {
  it.each([
    [401, /revoked|reissue/i],
    [403, /editor|read-only/i],
    [404, /workspace/i],
    [413, /size cap/i],
    [415, /file type/i],
    [429, /rate limited/i],
    [503, /queue is unavailable/i],
  ])("translates %i into an actionable message", async (status, pattern) => {
    mockFetch({ ok: false, status, text: "upstream detail" });

    const res = await parchment.query({ query: "a" });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(status);
      expect(res.error).toMatch(pattern);
    }
  });

  it("resolves rather than rejecting when the network fails", async () => {
    mockFetch({ reject: new Error("ECONNREFUSED") });

    // A throw here would break the chat turn instead of degrading the answer.
    const res = await parchment.query({ query: "a" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Could not reach Parchment/);
  });

  it("reports a timeout as a timeout, not a generic failure", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    mockFetch({ reject: abort });

    const res = await parchment.query({ query: "a" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/did not respond within \d+s/);
  });

  it("passes an unknown status through with its body, truncated", async () => {
    mockFetch({ ok: false, status: 500, text: "x".repeat(500) });
    const res = await parchment.query({ query: "a" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/^Parchment returned 500/);
      expect(res.error.length).toBeLessThan(260);
    }
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

  it("handles a section with no ancestors", () => {
    const flat = { ...result, results: [{ ...result.results[0], ancestors: [] }] };
    expect(toKnowledgeHits(flat)[0].context).toBeUndefined();
  });
});
