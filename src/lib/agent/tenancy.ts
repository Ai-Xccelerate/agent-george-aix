/**
 * Which organisation a deployment-wide credential is allowed to act for.
 *
 * Nylas and Scribe are each configured with ONE credential for the whole
 * deployment: a single mailbox grant, a single Scribe workspace token. Neither
 * has a per-org variant, so exactly one organisation's data is reachable
 * through them — no matter how many tenants exist in the database.
 *
 * WHY THIS MODULE EXISTS
 * The cron sweeps used to iterate every row in `orgs` and run the sync for each.
 * That is right for Composio, where each org connects its own account, and
 * badly wrong for a shared credential: instead of fanning out per tenant, it
 * copies the SAME tenant's data into every tenant's tables.
 *
 * On 2026-08-20 that ran for real. The first live Scribe sync mirrored 777 of
 * AIX's actual customer transcripts — sales calls, internal standups — into a
 * second, unrelated organisation, queued 652 agent events against them, and
 * spent roughly 650 model calls enriching the duplicates. It was still working
 * through the remaining organisations when it was stopped.
 *
 * So: a sweep driven by a shared credential runs for George's own organisation
 * and nowhere else. A sweep driven by per-org credentials keeps fanning out,
 * because there the fan-out is the correct behaviour.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The organisation George itself operates as — whose mailbox is George's
 * mailbox, and whose meetings the Scribe token can see.
 *
 * Returns null rather than guessing. A caller that cannot identify this org must
 * do nothing: picking an arbitrary org is how one tenant's data ends up in
 * another's tables.
 */
export function georgeOrgIdFromEnv(): string | null {
  return process.env.GEORGE_ORG_ID?.trim() || null;
}

/** Provider key for the row that says which org George's mailbox belongs to. */
export const MAILBOX_PROVIDER = "george_mailbox";

/**
 * Which organisation George operates as.
 *
 * Prefers DATA over configuration: an `integrations` row for the mailbox says
 * which org it belongs to, exactly as Parchment records its per-org config. The
 * env var is the single-tenant fallback, still correct while there is one
 * deployment-wide grant.
 *
 * This is the seam per-org mailboxes slot into. When each tenant has its own
 * grant there will be a row per org, this function is replaced by a lookup
 * keyed on the grant, and GEORGE_ORG_ID stops being consulted — without any
 * caller changing.
 *
 * Ambiguity is refused, not guessed. More than one connected mailbox row means
 * the deployment is already multi-mailbox and a single answer would be wrong;
 * doing nothing beats acting for the wrong tenant, which is the whole lesson of
 * 2026-08-20.
 */
export async function resolveGeorgeOrgId(
  admin: SupabaseClient,
): Promise<{ orgId: string | null; source: "integration" | "env" | "ambiguous" | "none" }> {
  try {
    const { data } = await admin
      .from("integrations")
      .select("org_id")
      .eq("provider", MAILBOX_PROVIDER)
      .eq("status", "connected");
    const rows = (data ?? []) as Array<{ org_id: string }>;
    if (rows.length === 1) return { orgId: rows[0].org_id, source: "integration" };
    if (rows.length > 1) return { orgId: null, source: "ambiguous" };
  } catch {
    // Table unreadable: fall through to the env fallback rather than throwing
    // inside a cron tick.
  }
  const fromEnv = georgeOrgIdFromEnv();
  return fromEnv ? { orgId: fromEnv, source: "env" } : { orgId: null, source: "none" };
}
