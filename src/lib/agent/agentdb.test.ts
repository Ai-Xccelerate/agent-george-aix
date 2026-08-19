/**
 * AgentDB wiring.
 *
 * The test that matters most here is the allowlist one. AgentDB's internal path
 * grants FULL scope — SQL, DML, DDL, files — and George reads untrusted inbound
 * email. The curated tool list is the only thing preventing a prompt-injected
 * message from reaching destructive SQL, so a regression that quietly adds
 * `run_sql` must fail loudly in CI rather than being noticed in production.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENTDB_TOOL_NAMES,
  agentDbDeployment,
  agentDbMissingVars,
  buildAgentDbMcpServer,
  isAgentDbConfigured,
} from "./agentdb";

const VARS = [
  "AGENTDB_API_URL",
  "AGENTDB_INTERNAL_AGENT_KEY",
  "PARCHMENT_INTERNAL_AGENT_KEY",
  "INTERNAL_AGENT_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

const ORG = "org_3DAfHZvqPP1jys65q7D7d9y79eD";

beforeEach(() => {
  for (const k of VARS) saved[k] = process.env[k];
  for (const k of VARS) delete process.env[k];
  process.env.AGENTDB_API_URL = "https://agentdb.example.test";
  process.env.AGENTDB_INTERNAL_AGENT_KEY = "shared-secret";
});

afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("the tool allowlist is the safety boundary", () => {
  it("exposes NO mutating tool", () => {
    // AgentDB's write surface, per docs/MCP_CLIENT.md. None of it may appear.
    const forbidden = [
      "run_sql",
      "upload_file",
      "delete_file",
      "mkdir",
      "move_file",
      "attach_file",
      "detach_file_link",
    ];
    for (const tool of forbidden) {
      expect(AGENTDB_TOOL_NAMES.some((t) => t.includes(tool))).toBe(false);
    }
  });

  it("allows get_agents_md, which AgentDB requires before any query", () => {
    // Without it, every query errors — so this one is not optional.
    expect(AGENTDB_TOOL_NAMES).toContain("mcp__agentdb__get_agents_md");
    expect(AGENTDB_TOOL_NAMES).toContain("mcp__agentdb__query");
  });

  it("namespaces every tool under the agentdb server", () => {
    for (const t of AGENTDB_TOOL_NAMES) expect(t.startsWith("mcp__agentdb__")).toBe(true);
  });
});

describe("configuration", () => {
  it("needs both a URL and a key", () => {
    expect(isAgentDbConfigured()).toBe(true);

    delete process.env.AGENTDB_INTERNAL_AGENT_KEY;
    expect(isAgentDbConfigured()).toBe(false);
    expect(agentDbMissingVars()).toEqual(["AGENTDB_INTERNAL_AGENT_KEY"]);

    delete process.env.AGENTDB_API_URL;
    expect(agentDbMissingVars()).toEqual([
      "AGENTDB_API_URL",
      "AGENTDB_INTERNAL_AGENT_KEY",
    ]);
  });

  it("falls back to the other names for the one shared secret", () => {
    // The same value is Core's INTERNAL_KB_UPLOAD_KEY and Parchment's
    // INTERNAL_AGENT_KEY, and people paste whichever name they have.
    delete process.env.AGENTDB_INTERNAL_AGENT_KEY;
    process.env.PARCHMENT_INTERNAL_AGENT_KEY = "from-parchment";
    expect(agentDbDeployment()?.internalKey).toBe("from-parchment");

    delete process.env.PARCHMENT_INTERNAL_AGENT_KEY;
    process.env.INTERNAL_AGENT_KEY = "bare-name";
    expect(agentDbDeployment()?.internalKey).toBe("bare-name");
  });

  it("prefers the prefixed name, so one service can be rotated alone", () => {
    process.env.PARCHMENT_INTERNAL_AGENT_KEY = "parchment-key";
    expect(agentDbDeployment()?.internalKey).toBe("shared-secret");
  });

  it("trims a trailing slash so the /mcp/ path never doubles up", () => {
    process.env.AGENTDB_API_URL = "https://agentdb.example.test/";
    expect(buildAgentDbMcpServer({ clerkOrgId: ORG })?.server.url).toBe(
      "https://agentdb.example.test/mcp/",
    );
  });
});

describe("buildAgentDbMcpServer", () => {
  it("sends the three internal headers and no Authorization", () => {
    const built = buildAgentDbMcpServer({ clerkOrgId: ORG })!;
    const h = built.server.headers as Record<string, string>;

    expect(h["X-Internal-Key"]).toBe("shared-secret");
    expect(h["X-Clerk-Org-Id"]).toBe(ORG);
    expect(h["X-Agent-Id"]).toBe("george");
    // The runtime path must NOT carry a bearer token — that is the enable path,
    // and sending both would be a different (JWT) auth mode.
    expect(h.Authorization).toBeUndefined();
  });

  it("keeps the trailing slash on /mcp/", () => {
    // AgentDB's docs warn some MCP clients don't follow the /mcp → /mcp/ redirect.
    expect(buildAgentDbMcpServer({ clerkOrgId: ORG })!.server.url).toMatch(/\/mcp\/$/);
  });

  it("omits X-Workspace-Id unless a workspace was chosen", () => {
    const dflt = buildAgentDbMcpServer({ clerkOrgId: ORG })!;
    expect((dflt.server.headers as Record<string, string>)["X-Workspace-Id"]).toBeUndefined();

    const chosen = buildAgentDbMcpServer({ clerkOrgId: ORG, workspaceId: "ws-2" })!;
    expect((chosen.server.headers as Record<string, string>)["X-Workspace-Id"]).toBe("ws-2");
  });

  it("returns null without a Clerk org id rather than sending a broken request", () => {
    // AgentDB has no other way to identify the tenant; a request without it
    // would 401, or worse resolve somewhere unintended.
    expect(buildAgentDbMcpServer({ clerkOrgId: null })).toBeNull();
  });

  it("returns null when unconfigured, so George still runs without AgentDB", () => {
    delete process.env.AGENTDB_API_URL;
    expect(buildAgentDbMcpServer({ clerkOrgId: ORG })).toBeNull();
  });
});
