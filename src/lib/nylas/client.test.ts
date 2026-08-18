/**
 * Nylas transport contract tests.
 *
 * What matters here isn't "does fetch work" — verify-nylas.ts proves that
 * against the real mailbox. These cover the promises the transport makes to
 * callers that sit on the chat path: it never throws, partial configuration
 * counts as off, and the send guard can trust what getDraft reports. All with
 * fetch mocked, so CI needs no key and no mailbox.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNylasClient,
  isNylasEnabled,
  nylasConfig,
  nylasMissingVars,
  recipientEmails,
} from "./client";

const VARS = [
  "NYLAS_API_URL",
  "NYLAS_API_KEY",
  "NYLAS_GRANT_ID",
  "NYLAS_FROM_EMAIL",
  "NYLAS_FROM_NAME",
] as const;
const saved: Record<string, string | undefined> = {};

const GRANT = "610baae9-c375-4742-82c3-fa533b7f86c6";

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  text?: string;
  reject?: Error;
}) {
  const spy = vi.fn(async () => {
    if (response.reject) throw response.reject;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: async () => response.text ?? "",
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function client() {
  return createNylasClient(nylasConfig()!);
}

beforeEach(() => {
  for (const k of VARS) saved[k] = process.env[k];
  process.env.NYLAS_API_URL = "https://api.us.nylas.com";
  process.env.NYLAS_API_KEY = "nyk_test_key";
  process.env.NYLAS_GRANT_ID = GRANT;
  delete process.env.NYLAS_FROM_EMAIL;
  delete process.env.NYLAS_FROM_NAME;
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
  it("needs both a key and a grant", () => {
    expect(isNylasEnabled()).toBe(true);

    delete process.env.NYLAS_GRANT_ID;
    // A key with no grant has no mailbox to act on — that is off, not partly on.
    expect(isNylasEnabled()).toBe(false);
    expect(nylasMissingVars()).toEqual(["NYLAS_GRANT_ID"]);

    delete process.env.NYLAS_API_KEY;
    expect(nylasMissingVars()).toEqual(["NYLAS_API_KEY", "NYLAS_GRANT_ID"]);
  });

  it("defaults the base URL to the US region and trims a trailing slash", () => {
    delete process.env.NYLAS_API_URL;
    expect(nylasConfig()?.base).toBe("https://api.us.nylas.com");

    process.env.NYLAS_API_URL = "https://api.eu.nylas.com/";
    expect(nylasConfig()?.base).toBe("https://api.eu.nylas.com");
  });
});

describe("request shape", () => {
  it("sends the bearer key and puts the grant in the path", async () => {
    const spy = mockFetch({ text: JSON.stringify({ data: [] }) });

    await client().listMessages({ limit: 5 });

    const [url, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      `https://api.us.nylas.com/v3/grants/${GRANT}/messages?limit=5`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer nyk_test_key");
  });

  it("unwraps the {data} envelope so callers get domain objects", async () => {
    mockFetch({ text: JSON.stringify({ data: { id: "m1", subject: "hi" }, request_id: "r" }) });

    const res = await client().getMessage("m1");

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ id: "m1", subject: "hi" });
  });

  it("clamps limit into the allowed range", async () => {
    const spy = mockFetch({ text: JSON.stringify({ data: [] }) });

    await client().listMessages({ limit: 9999 });
    expect(String((spy.mock.calls[0] as unknown as [URL])[0])).toContain("limit=200");

    await client().listMessages({ limit: 0 });
    expect(String((spy.mock.calls[1] as unknown as [URL])[0])).toContain("limit=1");
  });

  it("url-encodes ids so one can never break out of the path", async () => {
    const spy = mockFetch({ text: JSON.stringify({ data: {} }) });
    await client().getDraft("../../grants/someone-else");
    expect(String((spy.mock.calls[0] as unknown as [URL])[0])).not.toContain("/../");
  });

  it("omits empty recipient arrays rather than sending []", async () => {
    // Nylas rejects cc: [] on some operations instead of ignoring it.
    const spy = mockFetch({ text: JSON.stringify({ data: {} }) });

    await client().createDraft({
      to: [{ email: "a@b.com" }],
      cc: [],
      subject: "s",
      body: "<p>b</p>",
    });

    const body = JSON.parse((spy.mock.calls[0] as unknown as [URL, RequestInit])[1].body as string);
    expect(body.to).toEqual([{ email: "a@b.com" }]);
    expect("cc" in body).toBe(false);
  });

  it("passes reply_to_message_id through so replies stay threaded", async () => {
    const spy = mockFetch({ text: JSON.stringify({ data: {} }) });

    await client().send({
      to: [{ email: "a@b.com" }],
      subject: "re",
      body: "<p>x</p>",
      replyToMessageId: "msg-1",
    });

    const body = JSON.parse((spy.mock.calls[0] as unknown as [URL, RequestInit])[1].body as string);
    expect(body.reply_to_message_id).toBe("msg-1");
  });

  it("sends a draft by POSTing to the draft, with no body", async () => {
    const spy = mockFetch({ text: JSON.stringify({ data: { id: "sent" } }) });

    await client().sendDraft("d1");

    const [url, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`https://api.us.nylas.com/v3/grants/${GRANT}/drafts/d1`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });
});

describe("failure handling — never throws", () => {
  it.each([
    [401, /API key/i],
    [403, /scope/i],
    [404, /Not found/i],
    [410, /no longer valid/i],
    [429, /Rate limited/i],
  ])("turns %i into an actionable message", async (status, pattern) => {
    mockFetch({ ok: false, status, text: JSON.stringify({ error: { message: "upstream detail" } }) });

    const res = await client().listMessages();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(status);
      expect(res.error).toMatch(pattern);
      // The provider's own message is far more useful than the status alone.
      expect(res.error).toContain("upstream detail");
    }
  });

  it("resolves rather than rejecting when the network fails", async () => {
    mockFetch({ reject: new Error("ECONNREFUSED") });

    // Throwing here would break a chat turn instead of degrading it.
    const res = await client().listMessages();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Could not reach Nylas/);
  });

  it("reports a timeout as a timeout", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    mockFetch({ reject: abort });

    const res = await client().listMessages();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/did not respond within \d+s/);
  });

  it("survives a non-JSON error body", async () => {
    mockFetch({ ok: false, status: 502, text: "<html>bad gateway</html>" });
    const res = await client().listMessages();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/^Nylas returned 502/);
  });

  it("treats an empty 200 body as success (DELETE returns nothing)", async () => {
    mockFetch({ text: "" });
    const res = await client().deleteDraft("d1");
    expect(res.ok).toBe(true);
  });
});

describe("recipientEmails", () => {
  it("collects to, cc and bcc, lowercased", () => {
    // This is what the outbound guard checks, so it must see every address —
    // missing bcc would let a draft reach someone unreviewed.
    expect(
      recipientEmails({
        to: [{ email: "A@Example.com" }],
        cc: [{ email: "B@Example.com" }],
        bcc: [{ email: "C@Example.com" }],
      }),
    ).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it("ignores missing or blank addresses instead of emitting junk", () => {
    expect(recipientEmails({ to: undefined, cc: [{ email: "" }] })).toEqual([]);
  });
});
