/**
 * An org's Parchment connection — stored, resolved, tested, removed.
 *
 * WHY THIS IS PER-ORG DATA AND NOT AN ENVIRONMENT VARIABLE
 * A Parchment API key is bound to one workspace. George is multi-tenant, so two
 * orgs on the same deployment must be able to point at two different knowledge
 * hubs, and connecting one must not require a redeploy. That makes the
 * connection a row, not config — which is also what lets an admin do it from the
 * UI instead of asking an engineer.
 *
 * It lives in the existing `integrations` table (provider 'parchment'), the same
 * place Composio connections live, so status and history work the same way.
 *
 * CREDENTIAL HANDLING
 * The key is encrypted before it reaches the row (see lib/crypto/secret-box) and
 * never returned to the browser — only a fingerprint like "pcm_ab…9f21", which
 * is enough for an admin to tell one key from another after a rotation without
 * exposing the secret itself. `integrations.vault_secret_id` is unused: it
 * assumed Supabase Vault, which the Postgres migration removed.
 *
 * The environment variables remain as a deployment-wide default, so a
 * single-tenant install or a script can work without a row. An org's own
 * connection always wins.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createParchmentClient,
  parchmentConfig,
  type ParchmentConfig,
} from "./client";
import { fingerprint, open, seal, type SealedSecret } from "@/lib/crypto/secret-box";

const PROVIDER = "parchment";

/** What the UI is allowed to see. Deliberately contains no secret. */
export type ParchmentConnection = {
  connected: boolean;
  /** Where the connection came from — an org's own row, or the deployment default. */
  source: "org" | "environment" | "none";
  baseUrl: string | null;
  /** e.g. "pcm_ab…9f21" — identifies the key without revealing it. */
  keyFingerprint: string | null;
  status: "connected" | "disconnected" | "error" | "pending" | null;
  /** Free-text reason when the last check failed. */
  lastError: string | null;
  lastCheckedAt: string | null;
  /** Workspace stats captured at the last successful check. */
  documents: number | null;
  connectedBy: string | null;
};

type Metadata = {
  base_url?: string;
  key?: SealedSecret;
  key_fingerprint?: string;
  last_error?: string | null;
  last_checked_at?: string | null;
  documents?: number | null;
  connected_by?: string | null;
};

type Row = {
  id: string;
  status: string;
  account_label: string | null;
  metadata: Metadata | null;
  updated_at: string | null;
};

async function readRow(admin: SupabaseClient, orgId: string): Promise<Row | null> {
  const { data } = await admin
    .from("integrations")
    .select("id, status, account_label, metadata, updated_at")
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/**
 * The credentials George should use for this org, or null if it has none.
 *
 * Resolution order is org row, then environment. An org that has connected its
 * own hub must never silently fall through to a deployment default pointing at
 * someone else's workspace — so a row that exists but cannot be decrypted
 * returns null rather than falling back.
 */
export async function resolveParchmentConfig(
  admin: SupabaseClient,
  orgId: string,
): Promise<ParchmentConfig | null> {
  const row = await readRow(admin, orgId);
  if (row) {
    if (row.status === "disconnected") return null;
    const base = row.metadata?.base_url?.trim();
    const key = open(row.metadata?.key);
    if (base && key) return { base: base.replace(/\/+$/, ""), apiKey: key };
    // A row exists but is unusable — most likely APP_ENCRYPTION_KEY changed.
    // Falling back to the environment here would query the wrong workspace.
    return null;
  }
  return parchmentConfig();
}

/** Convenience: a client bound to this org's hub, or null if none is connected. */
export async function parchmentForOrg(admin: SupabaseClient, orgId: string) {
  const cfg = await resolveParchmentConfig(admin, orgId);
  return cfg ? createParchmentClient(cfg) : null;
}

/** Everything the settings UI needs, with no secret in it. */
export async function getParchmentConnection(
  admin: SupabaseClient,
  orgId: string,
): Promise<ParchmentConnection> {
  const row = await readRow(admin, orgId);

  if (row) {
    return {
      connected: row.status === "connected",
      source: "org",
      baseUrl: row.metadata?.base_url ?? null,
      keyFingerprint: row.metadata?.key_fingerprint ?? null,
      status: (row.status as ParchmentConnection["status"]) ?? null,
      lastError: row.metadata?.last_error ?? null,
      lastCheckedAt: row.metadata?.last_checked_at ?? null,
      documents: row.metadata?.documents ?? null,
      connectedBy: row.metadata?.connected_by ?? null,
    };
  }

  const env = parchmentConfig();
  if (env) {
    // A deployment-wide default. Shown as such so an admin understands why
    // George has knowledge they never connected here.
    return {
      connected: true,
      source: "environment",
      baseUrl: env.base,
      keyFingerprint: fingerprint(env.apiKey),
      status: "connected",
      lastError: null,
      lastCheckedAt: null,
      documents: null,
      connectedBy: null,
    };
  }

  return {
    connected: false,
    source: "none",
    baseUrl: null,
    keyFingerprint: null,
    status: null,
    lastError: null,
    lastCheckedAt: null,
    documents: null,
    connectedBy: null,
  };
}

export type TestResult =
  | { ok: true; documents: number | null; database: string | null }
  | { ok: false; error: string };

/**
 * Prove a base URL and key actually work before storing them.
 *
 * Health alone is not enough: `/health` needs no auth, so a wrong key would pass
 * it. `/documents` is the cheapest call that requires the key to resolve to a
 * workspace, which is what "connected" has to mean.
 */
export async function testParchmentCredentials(cfg: ParchmentConfig): Promise<TestResult> {
  const client = createParchmentClient(cfg);

  const health = await client.health();
  if (!health.ok) return { ok: false, error: health.error };

  const docs = await client.documents();
  if (!docs.ok) return { ok: false, error: docs.error };

  return {
    ok: true,
    documents: Array.isArray(docs.data) ? docs.data.length : null,
    database: typeof health.data?.database === "string" ? health.data.database : null,
  };
}

export type SaveResult =
  | { ok: true; documents: number | null }
  | { ok: false; error: string };

/**
 * Store a connection, but only one that has been proven to work.
 *
 * Saving an untested credential would produce an integration that reads
 * "connected" while every search silently falls back to local knowledge — the
 * failure mode this whole feature is meant to remove.
 */
export async function saveParchmentConnection(
  admin: SupabaseClient,
  orgId: string,
  input: { baseUrl: string; apiKey: string; actor: string | null },
): Promise<SaveResult> {
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = input.apiKey.trim();

  if (!/^https?:\/\/.+/.test(base)) {
    return { ok: false, error: "Enter the full API URL, starting with https://" };
  }
  if (!apiKey) return { ok: false, error: "Enter the API key." };

  const test = await testParchmentCredentials({ base, apiKey });
  if (!test.ok) return { ok: false, error: test.error };

  let sealed: SealedSecret;
  try {
    sealed = seal(apiKey);
  } catch (err) {
    // Refusing to store the key in plaintext is deliberate — see secret-box.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const metadata: Metadata = {
    base_url: base,
    key: sealed,
    key_fingerprint: fingerprint(apiKey),
    last_error: null,
    last_checked_at: new Date().toISOString(),
    documents: test.documents,
    connected_by: input.actor,
  };

  const { error } = await admin.from("integrations").upsert(
    {
      org_id: orgId,
      provider: PROVIDER,
      status: "connected",
      // Host only — a label an admin recognises, without the credential.
      account_label: safeHost(base),
      metadata,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "org_id,provider" },
  );
  if (error) return { ok: false, error: error.message };

  return { ok: true, documents: test.documents };
}

/**
 * Re-check a stored connection and record the outcome, so the settings page can
 * show a real state rather than whatever was true on the day it was connected.
 */
export async function recheckParchmentConnection(
  admin: SupabaseClient,
  orgId: string,
): Promise<TestResult> {
  const row = await readRow(admin, orgId);
  if (!row) return { ok: false, error: "No Parchment connection is stored for this organisation." };

  const base = row.metadata?.base_url;
  const key = open(row.metadata?.key);
  if (!base || !key) {
    return {
      ok: false,
      error:
        "The stored key could not be read. This usually means APP_ENCRYPTION_KEY changed — reconnect with the key again.",
    };
  }

  const test = await testParchmentCredentials({ base, apiKey: key });
  await admin
    .from("integrations")
    .update({
      status: test.ok ? "connected" : "error",
      metadata: {
        ...row.metadata,
        last_error: test.ok ? null : test.error,
        last_checked_at: new Date().toISOString(),
        documents: test.ok ? test.documents : (row.metadata?.documents ?? null),
      },
    })
    .eq("id", row.id);

  return test;
}

/**
 * Forget the connection entirely, including the ciphertext.
 *
 * The row is deleted rather than flagged disconnected: leaving an encrypted key
 * in the database after someone clicked Disconnect is not what they asked for.
 */
export async function disconnectParchment(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin
    .from("integrations")
    .delete()
    .eq("org_id", orgId)
    .eq("provider", PROVIDER);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}
