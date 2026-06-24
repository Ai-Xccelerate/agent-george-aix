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

// Curated allowlist — only what George needs for the kickoff / health flows.
// Deliberately excludes `get_chat` (in-meeting chat is noise for our use).
export const SCRIBE_TOOL_NAMES = [
  "mcp__scribe__list_meetings",
  "mcp__scribe__get_meeting",
  "mcp__scribe__get_transcript",
  "mcp__scribe__get_insights",
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
