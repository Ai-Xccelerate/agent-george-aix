/**
 * The email signature is customer-facing and was wrong for months: a fixed
 * block in the base prompt named Onyx (the first deployment) and a colleague's
 * personal mailbox, so every draft George produced for AIX told the recipient
 * the wrong company and gave them the wrong address to reply to.
 *
 * These tests keep two properties true: it follows the deployment's own data,
 * and it omits what it does not know instead of inventing it.
 *
 * GEORGE_ADDRESS is resolved once at module load, so it is mocked rather than
 * set through process.env — assigning the variable inside a test would have no
 * effect, which is exactly the trap that made the first version of this file
 * pass for the wrong reason.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "101959fa-084e-4a46-b51f-d289b02d746c";
const ADDRESS = "george@aiwkr.com";

let orgRow: Record<string, unknown> | null = null;

/** Minimal stand-in for the queries buildGeorgeSystemPrompt makes. */
function fakeAdmin() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: table === "orgs" ? orgRow : null, error: null }),
        then: (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: [] }),
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// George's address is resolved per organisation now, not read from a
// module-level env constant — so the resolver is what has to be mocked.
vi.mock("./identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./identity")>()),
  resolveOrgIdentity: async () => ({
    internalDomains: new Set(["aixccelerate.com"]),
    address: ADDRESS,
    domain: "aixccelerate.com",
  }),
}));

const { buildGeorgeSystemPrompt } = await import("./system-prompt");

async function signature(): Promise<string> {
  const prompt = await buildGeorgeSystemPrompt(fakeAdmin(), { orgId: ORG });
  return prompt.slice(prompt.indexOf("## Email signature"));
}

beforeEach(() => {
  // Carries a domain because the prompt now refuses to build without one — see
  // requireCompanyIdentity. The internal-domain tests below still exercise the
  // "no domain known" path, but through resolveOrgIdentity, which is a separate
  // question from "which company does George work for".
  orgRow = { name: "aix", display_name: null, domain: "aixccelerate.com" };
});

describe("the email signature", () => {
  it("names neither Onyx nor a colleague's mailbox", async () => {
    const sig = await signature();
    // The two exact values that shipped in customer-facing drafts.
    expect(sig).not.toContain("Onyx");
    expect(sig).not.toContain("manasa@");
  });

  it("carries the mailbox George actually sends from", async () => {
    expect(await signature()).toContain(`mailto:${ADDRESS}`);
  });

  it("uses the org's display name and domain when it has them", async () => {
    orgRow = { name: "aix", display_name: "AI Xccelerate", domain: "aixccelerate.com" };
    const sig = await signature();
    expect(sig).toContain("AI Xccelerate");
    expect(sig).toContain('href="https://aixccelerate.com"');
    // display_name wins over the raw slug.
    expect(sig).not.toContain("· aix<br>");
  });

  it("strips a scheme already present on the domain", async () => {
    orgRow = { name: "aix", display_name: null, domain: "https://aixccelerate.com/" };
    expect(await signature()).toContain('href="https://aixccelerate.com"');
  });

  it("omits the website link rather than linking nowhere", async () => {
    const sig = await signature();
    expect(sig).not.toContain('href="https://"');
  });

  it("refuses to build a prompt at all when the org profile is missing entirely", async () => {
    // THIS EXPECTATION IS THE REVERSE OF WHAT IT WAS, DELIBERATELY.
    //
    // It used to assert that George still signed off when the org profile was
    // missing — degrade gracefully, omit what you don't know. That is right for
    // the *contents* of a signature and wrong for the question "which company
    // does George work for", because the base prompt's first sentence answers
    // that whether or not anyone configured it.
    //
    // With no org row there is no company name, and a fallback would be a name
    // George introduces himself with to a customer. Refusing is loud and
    // happens before anything is sent; guessing is quiet and arrives in an
    // inbox. See requireCompanyIdentity in system-prompt.ts.
    orgRow = null;
    await expect(signature()).rejects.toThrow(/missing a name and a domain/);
  });

  it("names the organisation, not the deployment it was first written for", async () => {
    orgRow = { name: "aix", display_name: "AI Xccelerate", domain: "aixccelerate.com" };
    const prompt = await buildGeorgeSystemPrompt(fakeAdmin(), { orgId: ORG });
    expect(prompt).toContain("working at AI Xccelerate");
    expect(prompt).not.toContain("working at Onyx");
  });

  it("prefers the customer-facing display name over the slug", async () => {
    // `orgs.name` is often a slug ("aix"); display_name is what a human reads.
    orgRow = { name: "aix", display_name: "AI Xccelerate", domain: "aixccelerate.com" };
    const prompt = await buildGeorgeSystemPrompt(fakeAdmin(), { orgId: ORG });
    expect(prompt).toContain("working at AI Xccelerate");
    expect(prompt).not.toContain("working at aix.");
  });

  it("falls back to the legal name when there is no display name", async () => {
    orgRow = { name: "Contoso Ltd", display_name: null, domain: "contoso.example" };
    const prompt = await buildGeorgeSystemPrompt(fakeAdmin(), { orgId: ORG });
    expect(prompt).toContain("working at Contoso Ltd");
  });

  it("refuses when the org has a name but no domain", async () => {
    orgRow = { name: "Contoso Ltd", display_name: null, domain: null };
    await expect(signature()).rejects.toThrow(/missing a domain/);
  });

  it("tells the model not to retype it from memory", async () => {
    // The literal used to live in the base prompt, so a model that saw the old
    // copy could reproduce it. The instruction has to be explicit.
    const prompt = await buildGeorgeSystemPrompt(fakeAdmin(), { orgId: ORG });
    expect(prompt).toContain("never retype it from memory");
  });
});

describe("with no mailbox configured", () => {
  it("prints no address at all", async () => {
    // An unset GEORGE_EMAIL used to fall back to a real person. Empty is the
    // honest answer — the signature loses a line, nobody gets misdirected.
    vi.resetModules();
    vi.doMock("./identity", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./identity")>()),
      resolveOrgIdentity: async () => ({
        internalDomains: new Set<string>(),
        address: "",
        domain: null,
      }),
    }));
    const { buildGeorgeSystemPrompt: build } = await import("./system-prompt");
    const prompt = await build(fakeAdmin(), { orgId: ORG });
    const sig = prompt.slice(prompt.indexOf("## Email signature"));

    expect(sig).not.toContain("mailto:");
    expect(sig).toContain("<strong>George</strong>");
    vi.doUnmock("./identity");
  });
});

describe("the prompt states which domains are internal", () => {
  it("names them, so George knows the answer and not just the rule", async () => {
    // De-hardcoding the domain left George knowing internal recipients were fine
    // without knowing which addresses those were. In chat it then offered to
    // request approval for an address that was already internal.
    const prompt = await buildGeorgeSystemPrompt(fakeAdmin(), { orgId: ORG });
    expect(prompt).toContain("Internal addresses for this organisation");
    expect(prompt).toContain("@aixccelerate.com");
  });

  it("says so plainly when the org has no domain, rather than asserting one", async () => {
    vi.resetModules();
    vi.doMock("./identity", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./identity")>()),
      resolveOrgIdentity: async () => ({
        internalDomains: new Set<string>(),
        address: "",
        domain: null,
      }),
    }));
    const { buildGeorgeSystemPrompt: build } = await import("./system-prompt");
    const prompt = await build(fakeAdmin(), { orgId: ORG });
    expect(prompt).toContain("none configured");
    vi.doUnmock("./identity");
  });
});
