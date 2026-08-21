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

vi.mock("./identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./identity")>()),
  GEORGE_ADDRESS: ADDRESS,
}));

const { buildGeorgeSystemPrompt } = await import("./system-prompt");

async function signature(): Promise<string> {
  const prompt = await buildGeorgeSystemPrompt(fakeAdmin(), { orgId: ORG });
  return prompt.slice(prompt.indexOf("## Email signature"));
}

beforeEach(() => {
  orgRow = { name: "aix", display_name: null, domain: null };
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

  it("still signs off when the org profile is missing entirely", async () => {
    orgRow = null;
    const sig = await signature();
    expect(sig).toContain("<strong>George</strong>");
    // No dangling separators or empty team name.
    expect(sig).not.toContain(" · <br>");
    expect(sig).not.toContain("the  team");
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
      GEORGE_ADDRESS: "",
    }));
    const { buildGeorgeSystemPrompt: build } = await import("./system-prompt");
    const prompt = await build(fakeAdmin(), { orgId: ORG });
    const sig = prompt.slice(prompt.indexOf("## Email signature"));

    expect(sig).not.toContain("mailto:");
    expect(sig).toContain("<strong>George</strong>");
    vi.doUnmock("./identity");
  });
});
