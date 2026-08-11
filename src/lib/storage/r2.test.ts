/**
 * The R2 driver's guardrails.
 *
 * These are the checks that make a misconfigured deploy fail loudly instead of
 * writing files somewhere unexpected — the specific failure this migration was
 * asked to make impossible. They are pure config logic, so they run in CI with
 * no bucket and no credentials.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createR2Storage, isR2Enabled, r2Config } from "./r2";

const VARS = [
  "STORAGE_DRIVER",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_ORG_ASSETS",
  "R2_BUCKET_CUSTOMER_DOCS",
  "R2_PUBLIC_BASE_URL",
] as const;

const saved: Record<string, string | undefined> = {};

function complete() {
  process.env.STORAGE_DRIVER = "r2";
  process.env.R2_ACCOUNT_ID = "acct123";
  process.env.R2_ACCESS_KEY_ID = "key123";
  process.env.R2_SECRET_ACCESS_KEY = "secret123";
  process.env.R2_BUCKET_ORG_ASSETS = "george-org-assets-staging";
  process.env.R2_BUCKET_CUSTOMER_DOCS = "george-customer-docs-staging";
  process.env.R2_PUBLIC_BASE_URL = "https://assets-staging.aiworkforce.md";
}

beforeEach(() => {
  for (const k of VARS) saved[k] = process.env[k];
  complete();
});

afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isR2Enabled", () => {
  it("is off unless STORAGE_DRIVER says r2", () => {
    delete process.env.STORAGE_DRIVER;
    expect(isR2Enabled()).toBe(false);
    process.env.STORAGE_DRIVER = "supabase";
    expect(isR2Enabled()).toBe(false);
  });

  it("is case- and whitespace-tolerant, because env values get pasted", () => {
    process.env.STORAGE_DRIVER = " R2 ";
    expect(isR2Enabled()).toBe(true);
  });
});

describe("r2Config", () => {
  it("accepts a complete configuration", () => {
    const cfg = r2Config();
    expect(cfg.buckets["org-assets"]).toBe("george-org-assets-staging");
    expect(cfg.buckets["customer-docs"]).toBe("george-customer-docs-staging");
  });

  it.each([
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_ORG_ASSETS",
    "R2_BUCKET_CUSTOMER_DOCS",
    "R2_PUBLIC_BASE_URL",
  ])("refuses to run when %s is missing, and names it", (missing) => {
    delete process.env[missing];
    expect(() => r2Config()).toThrow(new RegExp(missing));
  });

  it("treats an empty or whitespace value as missing", () => {
    // A variable set to "" in a dashboard is the classic half-configured state.
    process.env.R2_BUCKET_CUSTOMER_DOCS = "   ";
    expect(() => r2Config()).toThrow(/R2_BUCKET_CUSTOMER_DOCS/);
  });

  it("names every missing variable at once, not just the first", () => {
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_PUBLIC_BASE_URL;
    expect(() => r2Config()).toThrow(/R2_ACCESS_KEY_ID, R2_PUBLIC_BASE_URL/);
  });

  it("rejects a public base URL that is not https", () => {
    // A bare hostname or http:// here means every logo 404s or loads insecurely,
    // and nothing else would catch it.
    process.env.R2_PUBLIC_BASE_URL = "assets-staging.aiworkforce.md";
    expect(() => r2Config()).toThrow(/must be an https/);
  });

  it("trims a trailing slash so URLs never double up", () => {
    process.env.R2_PUBLIC_BASE_URL = "https://assets-staging.aiworkforce.md/";
    expect(r2Config().publicBaseUrl).toBe("https://assets-staging.aiworkforce.md");
  });
});

describe("bucket resolution", () => {
  it("maps logical names to the environment's real buckets", () => {
    const url = createR2Storage()
      .from("org-assets")
      .getPublicUrl("org/logo.png").data.publicUrl;
    expect(url).toBe("https://assets-staging.aiworkforce.md/org/logo.png");
  });

  it("strips a leading slash rather than emitting a double slash", () => {
    const url = createR2Storage()
      .from("org-assets")
      .getPublicUrl("/org/logo.png").data.publicUrl;
    expect(url).toBe("https://assets-staging.aiworkforce.md/org/logo.png");
  });

  it("fails loudly on an unknown bucket name", () => {
    expect(() => createR2Storage().from("customer-docs-typo")).toThrow(/Unknown storage bucket/);
  });

  it("refuses to build a public URL for the private bucket", () => {
    // Returning a plausible URL here would publish a contract path. Throwing is
    // the safer failure: it can only happen through a code change, not user input.
    expect(() => createR2Storage().from("customer-docs").getPublicUrl("doc.pdf")).toThrow(
      /only valid for "org-assets"/,
    );
  });
});
