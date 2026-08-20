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

// The Scribe account George's note-taker runs under. Scribe's MCP exposes no
// whoami, so the bound account isn't discoverable at runtime — it's the mailbox
// the workspace token (SCRIBE_MCP_TOKEN) was minted for. Single-tenant (Onyx).
export const SCRIBE_ACCOUNT_EMAIL = "agent.george@getonyx.ai";

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
    account: connected ? SCRIBE_ACCOUNT_EMAIL : null,
    description:
      "Meeting note-taker — joins calls and produces transcripts + insights. Wired as a direct MCP server, not through Composio.",
  };
}
