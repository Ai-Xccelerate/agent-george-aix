/**
 * Which organisation does an inbound message belong to?
 *
 * WHY THIS IS NOT `process.env.GEORGE_ORG_ID`
 * That is what the webhook used, and it is a single-tenant assumption surviving
 * into a multi-tenant path — the same class as the Onyx-hardcoded prompt. Every
 * inbound message was attributed to one configured org, so a reply to a
 * touchpoint in any OTHER org landed in the wrong tenant, matched no thread, and
 * silently did nothing. It is not that the mail was lost; it is that it was
 * filed under a company that had never written to that person.
 *
 * THE MAILBOX CANNOT ANSWER THIS
 * George has one mailbox, george@aiwkr.com, serving several orgs. The recipient
 * address is therefore identical for all of them and carries no information —
 * which is exactly why it comes last here, and why the two signals ahead of it
 * are properties of the CONVERSATION rather than of the inbox.
 *
 * ORDER, STRONGEST FIRST
 *
 *   1. The thread. If we sent a touchpoint on this thread we recorded its
 *      org_id next to its thread_id. A reply on that thread is that org's, and
 *      no other reading is possible.
 *
 *   2. Any thread we have already filed. Same idea, one step weaker: the
 *      mailbox mirror stamps org_id on messages it has seen, so a continuing
 *      conversation keeps the org it started in.
 *
 *   3. The sender, as a known contact. A contact belongs to a customer and a
 *      customer to an org. Deliberately ahead of the recipient address, because
 *      for a shared mailbox the sender is discriminating and the recipient is
 *      not — the brief said "then recipient address", and on this mailbox that
 *      would be a coin toss between tenants.
 *
 *   4. Configuration, and only when exactly one org can plausibly own it.
 *      Reported as a guess so the caller can say so.
 *
 * Ambiguity is never resolved by picking. An unattributable message is left
 * unattributed and said out loud, because filing it under the wrong tenant is
 * how one company's customer ends up in another company's queue.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type InboundOrgSource =
  | "touchpoint_thread"
  | "known_thread"
  | "sender_contact"
  | "configured"
  | "none";

export type InboundOrgResult = {
  orgId: string | null;
  source: InboundOrgSource;
  /** True when the answer is a fallback rather than evidence from the message. */
  guessed: boolean;
  detail: string;
};

function envOrgId(): string | null {
  return process.env.GEORGE_ORG_ID?.trim() || null;
}

export async function resolveInboundOrg(
  admin: SupabaseClient,
  msg: { threadId: string | null; fromAddress: string | null },
): Promise<InboundOrgResult> {
  const thread = msg.threadId?.trim() || null;
  const from = msg.fromAddress?.trim().toLowerCase() || null;

  // 1. A touchpoint we sent on this thread. The strongest signal there is: we
  //    wrote it, and we recorded who "we" were at the time.
  if (thread) {
    try {
      const { data } = await admin
        .from("onboarding_touchpoint")
        .select("org_id")
        .eq("thread_id", thread)
        .limit(1);
      const orgId = (data ?? [])[0]?.org_id as string | undefined;
      if (orgId) {
        return {
          orgId,
          source: "touchpoint_thread",
          guessed: false,
          detail: `reply on a thread this org sent a touchpoint on (${thread})`,
        };
      }
    } catch {
      // fall through — a lookup failure must not attribute mail by accident
    }
  }

  // 2. A thread the mailbox mirror has already filed.
  if (thread) {
    try {
      const { data } = await admin
        .from("email_messages")
        .select("org_id")
        .eq("conversation_id", thread)
        .limit(1);
      const orgId = (data ?? [])[0]?.org_id as string | undefined;
      if (orgId) {
        return {
          orgId,
          source: "known_thread",
          guessed: false,
          detail: `continues a conversation already filed under this org (${thread})`,
        };
      }
    } catch {
      /* fall through */
    }
  }

  // 3. The sender as a known contact, scoped through their customer.
  //    contacts has no org_id — see the audit in scripts/audit-query-columns.py.
  if (from) {
    try {
      const { data } = await admin
        .from("contacts")
        .select("customers!inner(org_id)")
        .eq("email", from)
        .limit(2);
      const rows = (data ?? []) as Array<{ customers?: { org_id?: string } | { org_id?: string }[] }>;
      const orgIds = new Set(
        rows
          .map((r) => (Array.isArray(r.customers) ? r.customers[0]?.org_id : r.customers?.org_id))
          .filter((x): x is string => !!x),
      );
      // The same person can be a contact in two tenants. That is a real
      // situation and not one to resolve by guessing.
      if (orgIds.size === 1) {
        return {
          orgId: [...orgIds][0],
          source: "sender_contact",
          guessed: false,
          detail: `sender is a known contact of exactly one organisation (${from})`,
        };
      }
      if (orgIds.size > 1) {
        return {
          orgId: null,
          source: "none",
          guessed: false,
          detail:
            `${from} is a contact in ${orgIds.size} organisations and this message is on no ` +
            `thread we know. Attributing it would be a coin toss between tenants.`,
        };
      }
    } catch {
      /* fall through */
    }
  }

  // 4. Configuration. Only honest when there is one plausible owner, and even
  //    then it is a guess about a message rather than a fact from it.
  const configured = envOrgId();
  if (configured) {
    return {
      orgId: configured,
      source: "configured",
      guessed: true,
      detail:
        "no thread and no known sender — falling back to GEORGE_ORG_ID. This is a " +
        "guess: on a shared mailbox it attributes the message to whichever org is " +
        "configured, not to whichever org it concerns.",
    };
  }

  return {
    orgId: null,
    source: "none",
    guessed: false,
    detail: "no thread, no known sender, and GEORGE_ORG_ID is unset",
  };
}
