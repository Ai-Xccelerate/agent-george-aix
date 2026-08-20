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

/**
 * The organisation George itself operates as — whose mailbox is George's
 * mailbox, and whose meetings the Scribe token can see.
 *
 * Returns null rather than guessing. A caller that cannot identify this org must
 * do nothing: picking an arbitrary org is how one tenant's data ends up in
 * another's tables.
 */
export function georgeOrgId(): string | null {
  return process.env.GEORGE_ORG_ID?.trim() || null;
}
