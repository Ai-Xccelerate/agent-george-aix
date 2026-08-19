/**
 * AgentDB — the org's operational database, George's CRM.
 *
 * AgentDB is a remote MCP server, so it is wired straight into the Agent SDK's
 * `mcpServers` rather than wrapped as in-process tools — the same treatment
 * Scribe gets. See src/lib/agent/scribe.ts for the precedent.
 *
 * TWO AUTH PHASES, AND THEY ARE NOT INTERCHANGEABLE
 * (docs/agent-integration-internal.md in Ai-Xccelerate/agentdb-aix)
 *
 *   enable   POST /internal/orgs/{clerk_org_id}/workspaces/resolve
 *            X-Internal-Key + X-Agent-Id + Authorization: Bearer <user Clerk JWT>
 *            Runs Core's /access entitlement check and MAY provision. Needs a
 *            real human session, so it only ever happens from a settings action.
 *
 *   runtime  X-Internal-Key + X-Clerk-Org-Id + X-Agent-Id  (+ optional
 *            X-Workspace-Id). No Authorization header. Returns 403 until the org
 *            has been enabled — MCP never provisions.
 *
 * That is the opposite of Parchment, which is default-allow and provisions on
 * first touch. Here an org must be deliberately switched on by a person whose
 * JWT proves Core entitlement, which is why this one *does* get a UI toggle.
 *
 * THE TOOL ALLOWLIST IS THE SAFETY BOUNDARY — READ THIS BEFORE WIDENING IT
 * The internal path grants FULL scope: SQL, DML, DDL, files, screens. The
 * AgentDB doc says so plainly — "same blast radius as a Connect 'full' key".
 *
 * George reads untrusted inbound email. If `run_sql` were exposed, a
 * prompt-injected message could drop tables in the org's CRM, and no code here
 * would stop it. So this ships READ-ONLY, and the allowlist below is the only
 * thing standing between an injected instruction and destructive SQL.
 *
 * Widening it is one line. Do that deliberately, and prefer routing mutations
 * through an explicit human confirmation — the pattern send_email_draft already
 * uses for irreversible actions — rather than handing the model a DDL-capable
 * tool.
 */
import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Attribution sent as X-Agent-Id; lands on `caller_agent_label` server-side. */
export const AGENT_ID = "george";

/**
 * Curated, READ-ONLY. Deliberately excludes every mutating tool AgentDB offers:
 * run_sql (DML/DDL), upload_file, delete_file, mkdir, move_file, attach_file,
 * detach_file_link.
 *
 * `get_agents_md` is not optional — AgentDB errors on query until the live
 * AGENTS.md has been loaded in the session, so it must be allowed and George
 * must be told to call it first (see prompt.ts).
 */
export const AGENTDB_TOOL_NAMES = [
  "mcp__agentdb__get_agents_md",
  "mcp__agentdb__query",
  "mcp__agentdb__list_files",
  "mcp__agentdb__get_file_url",
] as const;

export type AgentDbDeployment = { base: string; internalKey: string };

/**
 * Deployment-level settings, or null when this path is switched off.
 *
 * Both are required: the key without a URL has nowhere to go, and the URL
 * without the key gets a 401 on every call. Half-configured counts as off.
 *
 * The internal key is shared across AIX agent products (the same secret Core
 * and Parchment use), so it must never reach a browser.
 */
export function agentDbDeployment(): AgentDbDeployment | null {
  const base = process.env.AGENTDB_API_URL?.trim().replace(/\/+$/, "");
  // One shared secret spans the AIX agent products (Core's INTERNAL_KB_UPLOAD_KEY,
  // Parchment's INTERNAL_AGENT_KEY, this). Accept the prefixed name first so a
  // deployment can rotate one service independently, then the names people
  // actually paste: Parchment's, and the bare INTERNAL_AGENT_KEY the AgentDB
  // docs use for its own backend.
  const internalKey =
    process.env.AGENTDB_INTERNAL_AGENT_KEY?.trim() ||
    process.env.PARCHMENT_INTERNAL_AGENT_KEY?.trim() ||
    process.env.INTERNAL_AGENT_KEY?.trim();
  if (!base || !internalKey) return null;
  return { base, internalKey };
}

export function isAgentDbConfigured(): boolean {
  return agentDbDeployment() !== null;
}

export function agentDbMissingVars(): string[] {
  const missing: string[] = [];
  if (!process.env.AGENTDB_API_URL?.trim()) missing.push("AGENTDB_API_URL");
  if (
    !process.env.AGENTDB_INTERNAL_AGENT_KEY?.trim() &&
    !process.env.PARCHMENT_INTERNAL_AGENT_KEY?.trim() &&
    !process.env.INTERNAL_AGENT_KEY?.trim()
  ) {
    missing.push("AGENTDB_INTERNAL_AGENT_KEY");
  }
  return missing;
}

/** The org's Clerk id — AgentDB's tenant key, same as Parchment's. */
export async function clerkOrgIdFor(
  admin: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("orgs")
    .select("clerk_org_id")
    .eq("id", orgId)
    .maybeSingle();
  const value = (data as { clerk_org_id?: string | null } | null)?.clerk_org_id;
  return value?.trim() || null;
}

/**
 * The MCP server config for one org, or null when unusable.
 *
 * Returns null rather than throwing so a caller can spread it conditionally and
 * George still runs without AgentDB — the same contract buildScribeMcpServer has.
 *
 * Note the trailing slash on /mcp/: the AgentDB docs warn that some MCP clients
 * don't cleanly follow the /mcp → /mcp/ redirect.
 */
export function buildAgentDbMcpServer(args: {
  clerkOrgId: string | null;
  workspaceId?: string | null;
}): { server: McpHttpServerConfig; toolNames: string[] } | null {
  const cfg = agentDbDeployment();
  if (!cfg || !args.clerkOrgId) return null;

  const headers: Record<string, string> = {
    "X-Internal-Key": cfg.internalKey,
    "X-Clerk-Org-Id": args.clerkOrgId,
    "X-Agent-Id": AGENT_ID,
  };
  // Absent means the org's Default workspace, which is what almost every org
  // wants; only send one when a specific workspace was chosen.
  if (args.workspaceId) headers["X-Workspace-Id"] = args.workspaceId;

  return {
    server: { type: "http", url: `${cfg.base}/mcp/`, headers },
    toolNames: [...AGENTDB_TOOL_NAMES],
  };
}

export type AgentDbWorkspace = { id: string; name: string; visibility: string };

export type EnableResult =
  | { ok: true; hasAccess: true; defaultWorkspaceId: string | null; workspaces: AgentDbWorkspace[] }
  /** Org exists but Core says it isn't entitled — a real answer, not an error. */
  | { ok: true; hasAccess: false }
  | { ok: false; error: string };

/**
 * Turn AgentDB on for an org.
 *
 * Requires the signed-in user's Clerk JWT: AgentDB re-checks entitlement against
 * Core, so this cannot run from a background job or a shared secret alone. The
 * JWT's org must match the clerk_org_id or AgentDB returns org_mismatch.
 *
 * Never throws — a settings screen should show why it failed, not 500.
 */
export async function enableAgentDbForOrg(args: {
  clerkOrgId: string;
  clerkJwt: string;
}): Promise<EnableResult> {
  const cfg = agentDbDeployment();
  if (!cfg) {
    return {
      ok: false,
      error: `AgentDB is not configured on this deployment (missing ${agentDbMissingVars().join(", ")}).`,
    };
  }

  const url = `${cfg.base}/internal/orgs/${encodeURIComponent(args.clerkOrgId)}/workspaces/resolve`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Internal-Key": cfg.internalKey,
        "X-Agent-Id": AGENT_ID,
        Authorization: `Bearer ${args.clerkJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agent_id: AGENT_ID }),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();

    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        detail = (JSON.parse(text) as { detail?: string }).detail ?? detail;
      } catch {
        /* keep the raw body */
      }
      // Translated from the doc's error table into something an admin can act on.
      const known: Record<number, string> = {
        401: "AgentDB rejected the request (401). Either the shared key is wrong, or your session's organisation doesn't match this one.",
        403: "AgentDB's internal agent path is disabled (403) — INTERNAL_AGENT_KEY is not set on the AgentDB backend.",
        503: "AgentDB couldn't reach AIX Core to check entitlement (503). It fails closed, so try again shortly.",
      };
      return { ok: false, error: known[res.status] ?? `AgentDB returned ${res.status}: ${detail}` };
    }

    const body = JSON.parse(text) as {
      has_access?: boolean;
      default_workspace_id?: string | null;
      workspaces?: AgentDbWorkspace[];
    };

    // A 200 with has_access:false is the documented "not entitled in Core"
    // answer. Nothing was created, and it is not a failure to report as one.
    if (body.has_access === false) return { ok: true, hasAccess: false };

    return {
      ok: true,
      hasAccess: true,
      defaultWorkspaceId: body.default_workspace_id ?? null,
      workspaces: body.workspaces ?? [],
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? "AgentDB did not respond within 20s."
        : `Could not reach AgentDB: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is AgentDB actually usable for this org right now?
 *
 * Asks AgentDB rather than trusting stored state: it answers 403 until an org is
 * enabled, so one cheap request is a truthful health check. `GET /AGENTS.md` is
 * used because it needs no MCP session and returns the same 403.
 */
export async function checkAgentDbAccess(clerkOrgId: string): Promise<
  { reachable: true; enabled: boolean; detail: string | null } | { reachable: false; detail: string }
> {
  const cfg = agentDbDeployment();
  if (!cfg) return { reachable: false, detail: "AgentDB is not configured on this deployment." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${cfg.base}/AGENTS.md`, {
      headers: {
        "X-Internal-Key": cfg.internalKey,
        "X-Clerk-Org-Id": clerkOrgId,
        "X-Agent-Id": AGENT_ID,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.ok) return { reachable: true, enabled: true, detail: null };
    if (res.status === 403) {
      return {
        reachable: true,
        enabled: false,
        detail: "Not enabled for this organisation yet.",
      };
    }
    return { reachable: true, enabled: false, detail: `AgentDB returned ${res.status}.` };
  } catch (err) {
    return {
      reachable: false,
      detail: `Could not reach AgentDB: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
