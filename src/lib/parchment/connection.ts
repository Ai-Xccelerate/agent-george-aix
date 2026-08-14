/**
 * Resolving an org's Parchment knowledge base.
 *
 * WHAT CHANGED, AND WHY THERE IS NO LONGER A CREDENTIAL HERE
 * The first version of this file stored a per-org API key, encrypted, because
 * Parchment's public path requires a human to mint one per workspace. The
 * internal agent path (docs/agent-integration-internal.md in the Parchment repo)
 * removed that entirely: George presents one deployment-level shared secret plus
 * the org's Clerk id, and Parchment resolves — or lazily creates — that org's
 * default workspace. Access is default-allow for every org.
 *
 * So the only per-org state left is genuinely a preference, not a secret:
 *
 *   - which workspace to use, when an org has created more than the default one
 *   - whether to use Parchment for this org at all (an opt-OUT escape hatch)
 *
 * Both live in the existing `integrations` table under provider 'parchment',
 * alongside the Composio connections. Nothing sensitive is stored, which is why
 * the encryption helper this module used to depend on is gone.
 *
 * The tenant key is `orgs.clerk_org_id`, mirrored by lib/aix-core/jit-mirror on
 * first sign-in. An org without one cannot be resolved — Parchment has no other
 * way to identify it — and that is reported rather than guessed at.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createParchmentClient,
  documentCount,
  parchmentDeployment,
  type ParchmentConfig,
  type ParchmentWorkspace,
} from "./client";

const PROVIDER = "parchment";

type Metadata = {
  /** Chosen workspace, when the org picked one other than the default. */
  workspace_id?: string | null;
  workspace_name?: string | null;
  /** Opt-out. Absent or true means Parchment is in use. */
  enabled?: boolean;
  /** Cached from the last successful resolve, for display only. */
  known_workspaces?: ParchmentWorkspace[];
  default_workspace_id?: string | null;
  last_error?: string | null;
  last_checked_at?: string | null;
  documents?: number | null;
  updated_by?: string | null;
};

type Row = {
  id: string;
  status: string;
  metadata: Metadata | null;
};

async function readRow(admin: SupabaseClient, orgId: string): Promise<Row | null> {
  const { data } = await admin
    .from("integrations")
    .select("id, status, metadata")
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** The org's Clerk organization id — Parchment's tenant identifier. */
async function clerkOrgIdFor(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await admin
    .from("orgs")
    .select("clerk_org_id")
    .eq("id", orgId)
    .maybeSingle();
  const value = (data as { clerk_org_id?: string | null } | null)?.clerk_org_id;
  return value?.trim() || null;
}

export type ResolveFailure =
  | { reason: "not_configured"; missing: string[] }
  | { reason: "opted_out" }
  | { reason: "no_clerk_org" };

/**
 * The config George should use for this org, or a reason it cannot.
 *
 * Returns a discriminated failure rather than plain null so the Settings panel
 * can explain which of the three very different situations applies instead of
 * showing one vague "not connected".
 */
export async function resolveParchmentConfig(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ ok: true; config: ParchmentConfig } | { ok: false; failure: ResolveFailure }> {
  const deployment = parchmentDeployment();
  if (!deployment) {
    const { parchmentMissingVars } = await import("./client");
    return { ok: false, failure: { reason: "not_configured", missing: parchmentMissingVars() } };
  }

  const row = await readRow(admin, orgId);
  if (row?.metadata?.enabled === false) {
    return { ok: false, failure: { reason: "opted_out" } };
  }

  const clerkOrgId = await clerkOrgIdFor(admin, orgId);
  if (!clerkOrgId) return { ok: false, failure: { reason: "no_clerk_org" } };

  return {
    ok: true,
    config: {
      ...deployment,
      clerkOrgId,
      workspaceId: row?.metadata?.workspace_id ?? null,
    },
  };
}

/** A client for this org's knowledge base, or null when unavailable. */
export async function parchmentForOrg(admin: SupabaseClient, orgId: string) {
  const res = await resolveParchmentConfig(admin, orgId);
  return res.ok ? createParchmentClient(res.config) : null;
}

export type ParchmentStatus = {
  /** Whether George will query Parchment for this org right now. */
  active: boolean;
  /** Why not, when inactive. */
  failure: ResolveFailure | null;
  endpoint: string | null;
  /** Live-resolved workspaces, when reachable. */
  workspaces: ParchmentWorkspace[];
  defaultWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  documents: number | null;
  reachable: boolean;
  error: string | null;
};

/**
 * Everything the Settings panel needs, resolved live.
 *
 * Deliberately hits Parchment during render: the previous version's stored
 * "connected" flag could disagree with reality, and the whole point of this panel
 * is to tell an admin what George will actually do on the next question. The
 * resolve call also provisions the org's default workspace on first view, which
 * is why simply opening the page is enough to set an org up.
 */
export async function getParchmentStatus(
  admin: SupabaseClient,
  orgId: string,
): Promise<ParchmentStatus> {
  const empty: ParchmentStatus = {
    active: false,
    failure: null,
    endpoint: parchmentDeployment()?.base ?? null,
    workspaces: [],
    defaultWorkspaceId: null,
    selectedWorkspaceId: null,
    documents: null,
    reachable: false,
    error: null,
  };

  const resolved = await resolveParchmentConfig(admin, orgId);
  if (!resolved.ok) return { ...empty, failure: resolved.failure };

  const row = await readRow(admin, orgId);
  const client = createParchmentClient(resolved.config);

  const [ws, docs] = await Promise.all([client.resolveWorkspaces(), client.documents()]);

  if (!ws.ok) {
    return {
      ...empty,
      active: true,
      endpoint: resolved.config.base,
      selectedWorkspaceId: resolved.config.workspaceId ?? null,
      reachable: false,
      error: ws.error,
      // Fall back to whatever the last successful resolve saw, so the dropdown
      // is not empty just because Parchment is briefly down.
      workspaces: row?.metadata?.known_workspaces ?? [],
      defaultWorkspaceId: row?.metadata?.default_workspace_id ?? null,
      documents: row?.metadata?.documents ?? null,
    };
  }

  return {
    active: true,
    failure: null,
    endpoint: resolved.config.base,
    workspaces: ws.data.workspaces ?? [],
    defaultWorkspaceId: ws.data.default_workspace_id ?? null,
    selectedWorkspaceId: resolved.config.workspaceId ?? null,
    documents: docs.ok ? documentCount(docs.data) : null,
    reachable: true,
    error: null,
  };
}

type Mutation = { ok: true } | { ok: false; error: string };

async function writeMetadata(
  admin: SupabaseClient,
  orgId: string,
  patch: Metadata,
  actor: string | null,
): Promise<Mutation> {
  const row = await readRow(admin, orgId);
  const metadata: Metadata = {
    ...(row?.metadata ?? {}),
    ...patch,
    last_checked_at: new Date().toISOString(),
    updated_by: actor,
  };

  const { error } = await admin.from("integrations").upsert(
    {
      org_id: orgId,
      provider: PROVIDER,
      // 'connected' unless the org opted out — there is no credential to be
      // pending or in error about on this path.
      status: metadata.enabled === false ? "disconnected" : "connected",
      account_label: metadata.workspace_name ?? "Default workspace",
      metadata,
    },
    { onConflict: "org_id,provider" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Choose which workspace George reads. `null` means the org's default, which is
 * also what an org with a single workspace always wants.
 */
export async function selectWorkspace(
  admin: SupabaseClient,
  orgId: string,
  workspaceId: string | null,
  actor: string | null,
): Promise<Mutation> {
  const resolved = await resolveParchmentConfig(admin, orgId);
  if (!resolved.ok) return { ok: false, error: describeFailure(resolved.failure) };

  const client = createParchmentClient(resolved.config);
  const ws = await client.resolveWorkspaces();
  if (!ws.ok) return { ok: false, error: ws.error };

  // Validate against what the org actually has. Parchment would reject a
  // mismatched workspace with a 401 at query time — long after the click, and
  // reported to the wrong person.
  const known = ws.data.workspaces ?? [];
  const chosen = workspaceId ? known.find((w) => w.id === workspaceId) : null;
  if (workspaceId && !chosen) {
    return { ok: false, error: "That workspace is not available to this organisation." };
  }

  return writeMetadata(
    admin,
    orgId,
    {
      workspace_id: chosen ? chosen.id : null,
      workspace_name: chosen ? chosen.name : null,
      known_workspaces: known,
      default_workspace_id: ws.data.default_workspace_id ?? null,
      enabled: true,
      last_error: null,
    },
    actor,
  );
}

/**
 * The opt-out. Per Parchment's own UI guidance a toggle only earns its place as
 * an escape hatch — access is default-allow, so there is nothing to switch on —
 * and this is that escape hatch: knowledge grounding off for this org.
 */
export async function setParchmentEnabled(
  admin: SupabaseClient,
  orgId: string,
  enabled: boolean,
  actor: string | null,
): Promise<Mutation> {
  return writeMetadata(admin, orgId, { enabled }, actor);
}

/** Human-readable form of a resolve failure, for UI and tool logs. */
export function describeFailure(failure: ResolveFailure): string {
  switch (failure.reason) {
    case "not_configured":
      return `Parchment is not configured on this deployment (missing ${failure.missing.join(", ")}).`;
    case "opted_out":
      return "Parchment is switched off for this organisation.";
    case "no_clerk_org":
      return "This organisation has no Clerk organization id yet, which Parchment uses to identify it. It is set on first sign-in through AIX Core.";
  }
}
