/**
 * Scribe — George's meeting note-taker. Scribe is a remote MCP server (HTTP),
 * wired directly into the Agent SDK's `mcpServers` rather than wrapped as
 * in-process tools: its tools are read-only (no external side effects to audit),
 * so the Composio-style in-process wrapping isn't needed here.
 *
 * Single-account integration: one workspace token (SCRIBE_MCP_TOKEN) for the
 * Onyx note-taker, not a per-org Composio identity. Server-only — never import
 * this from a client component.
 *
 * Replaces the previous Fireflies-via-Composio transcript tools.
 */
import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";

/**
 * What George's Scribe token can actually see.
 *
 * Scribe's MCP exposes no whoami, so the bound account is not discoverable —
 * this used to be a hardcoded address at a company the deployment no longer
 * belongs to. Making it configurable then left it blank, which was worse: the
 * Identity row renders `account ?? "Not connected"`, so an unset value made a
 * working integration report itself as disconnected next to a green pill.
 *
 * The token itself is the honest source. Scribe mints two kinds, and the
 * difference is operationally significant rather than cosmetic:
 *
 *   sk_scribe_org_…   the whole workspace's meetings
 *   sk_scribe_…       only the meetings one person owns or attended
 *
 * A user-scoped key silently limits George to whoever minted it — the sort of
 * gap that shows up as "some meetings are missing" months later. Saying which
 * kind is in use puts that on screen instead.
 */
export type ScribeTokenScope = "org" | "user" | "unknown";

export function scribeTokenScope(): ScribeTokenScope {
  const token = process.env.SCRIBE_MCP_TOKEN?.trim() ?? "";
  if (!token) return "unknown";
  if (token.startsWith("sk_scribe_org_")) return "org";
  if (token.startsWith("sk_scribe_")) return "user";
  return "unknown";
}

/**
 * The label shown as George's note-taker account.
 *
 * SCRIBE_ACCOUNT_EMAIL wins when set, for deployments that do know the mailbox.
 * Otherwise describe the reach, which is the fact people actually need.
 */
export function scribeAccountLabel(): string {
  const configured = process.env.SCRIBE_ACCOUNT_EMAIL?.trim();
  if (configured) return configured;
  switch (scribeTokenScope()) {
    case "org":
      return "Every meeting in the workspace";
    case "user":
      return "One member's meetings only — an org-scoped key sees the whole workspace";
    default:
      return "Connected";
  }
}

// Curated allowlist — only what George needs for the kickoff / health flows.
// Deliberately excludes `get_chat` (in-meeting chat is noise for our use).
//
// `get_action_items` reads Scribe's live action-items table — owner email,
// completion status, parsed due dates, filterable by meeting or owner — which is
// materially better for chasing onboarding commitments than the frozen copy
// inside a meeting's insights blob.
export const SCRIBE_TOOL_NAMES = [
  "mcp__scribe__list_meetings",
  "mcp__scribe__get_meeting",
  "mcp__scribe__get_transcript",
  "mcp__scribe__get_insights",
  "mcp__scribe__get_action_items",
] as const;

/**
 * Returns the Scribe MCP server config + its allowed tool names, or null when
 * Scribe isn't configured (so the agent still runs without it). Spread the
 * result into the `query()` options at each call site.
 */
export function buildScribeMcpServer(): {
  server: McpHttpServerConfig;
  toolNames: string[];
} | null {
  const url = process.env.SCRIBE_MCP_URL?.trim();
  const token = process.env.SCRIBE_MCP_TOKEN?.trim();
  if (!url || !token) return null;

  return {
    server: {
      type: "http",
      url,
      headers: { Authorization: `Bearer ${token}` },
    },
    toolNames: [...SCRIBE_TOOL_NAMES],
  };
}

/** True when Scribe is wired (same condition the agent runtime uses to load it). */
export function isScribeConfigured(): boolean {
  return buildScribeMcpServer() !== null;
}

export type ScribeConnection = {
  connected: boolean;
  /** The Scribe account George's note-taker runs under, when connected. */
  account: string | null;
  description: string;
};

/**
 * Scribe's connection status for the UI. Unlike the Composio integrations,
 * this is derived purely from env (the same check the runtime uses) — it does
 * NOT depend on Composio being reachable, so the status stays correct even
 * during a Composio outage.
 */
export function getScribeConnection(): ScribeConnection {
  const connected = isScribeConfigured();
  return {
    connected,
    account: connected ? scribeAccountLabel() : null,
    description:
      "Meeting note-taker — joins calls and produces transcripts + insights. Wired as a direct MCP server, not through Composio.",
  };
}
