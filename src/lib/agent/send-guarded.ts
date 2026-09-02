/**
 * The one place a draft is allowed to leave the building.
 *
 * WHY THIS IS A SHARED FUNCTION AND NOT TWO COPIES
 * Two paths now send customer mail: George's `send_email_draft` tool, and a
 * human approving a decision that carries a draft. If each implemented the
 * guards, they would drift, and the one that drifted would be the one nobody
 * was watching.
 *
 * There is a third path, `sendMailboxDraftAction`, which deliberately has no
 * guards at all: it is the human escape hatch, a person clicking send on a
 * draft they are looking at in the mailbox. The approval path must NOT reuse
 * it. An approval is George's composition going out under a human's sign-off,
 * not a human sending their own mail — and routing it through the unguarded
 * path would make both guards decorative on the one path that actually carries
 * onboarding email.
 *
 * WHAT IS GUARDED, AND WHY EACH ONE EXISTS
 *
 *   Volume.    2026-08-20: every recipient check held perfectly and George
 *              still sent 16 emails in 90 minutes, because nothing had an
 *              opinion about HOW MUCH. See outbound-limits.ts.
 *
 *   Recipients. Re-read from the provider, never taken from what the caller
 *              asserts. A draft can be edited between composition and send,
 *              and the check has to run against what will actually go.
 *
 *   Fail closed. Recipients that cannot be parsed are refused rather than
 *              assumed internal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createNylasClient,
  nylasConfig,
  recipientEmails,
  type NylasMessage,
} from "@/lib/nylas/client";
import { isInternalTo, resolveOrgIdentity } from "./identity";
import { checkSendRate, sendRateMessage } from "./outbound-limits";

export type SendMode = "chat" | "autonomous";

export type GuardedSendInput = {
  db: SupabaseClient;
  orgId: string;
  draftId: string;
  /**
   * Which ceiling applies.
   *
   * "chat" (15/hr) is only correct when a human authorised THIS send. The
   * approval path earns it by carrying a draft id it verified; a run that
   * composes and sends on its own does not, and stays on "autonomous" (3/hr).
   * Passing "chat" from an unattended path would quietly remove the volume
   * limit from the exact situation it was written for.
   */
  mode: SendMode;
  /** Who is accountable. "george" for agent sends, a user id for approvals. */
  actor: string;
  sessionId?: string | null;
  customerId?: string | null;
  /** Extra context for the audit row, e.g. the escalation that approved it. */
  auditExtra?: Record<string, unknown>;
};

export type GuardedSendResult =
  | { ok: true; messageId: string | null; recipients: string[] }
  | { ok: false; reason: string; code: "not_configured" | "rate_limited" | "recipients_unparsed" | "domain_not_approved" | "provider_error" };

async function audit(
  input: GuardedSendInput,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await input.db.from("audit_log").insert({
    org_id: input.orgId,
    actor: input.actor,
    action,
    customer_id: input.customerId ?? null,
    session_id: input.sessionId ?? null,
    payload: { ...payload, ...(input.auditExtra ?? {}) },
  });
}

/**
 * The org's approved external domains. Fails CLOSED — a query error yields an
 * empty set rather than "allow everything", because this is an allowlist.
 */
async function approvedDomains(db: SupabaseClient, orgId: string): Promise<Set<string>> {
  const { data, error } = await db
    .from("domain_allowlist")
    .select("domain")
    .eq("org_id", orgId)
    .eq("status", "approved");
  if (error || !data) return new Set();
  return new Set((data as { domain: string }[]).map((r) => r.domain.toLowerCase()));
}

export async function sendDraftGuarded(input: GuardedSendInput): Promise<GuardedSendResult> {
  const cfg = nylasConfig();
  if (!cfg) {
    return { ok: false, code: "not_configured", reason: "No mail provider is configured." };
  }
  const nylas = createNylasClient(cfg);

  // Volume first, before any provider work.
  const rate = await checkSendRate(input.db, input.orgId, input.mode);
  if (!rate.allowed) {
    await audit(input, "email.send_blocked", {
      draft_id: input.draftId,
      reason: "rate_limited",
      sent_last_hour: rate.sent,
      cap: rate.cap,
      mode: rate.mode,
    });
    return { ok: false, code: "rate_limited", reason: sendRateMessage(rate) };
  }

  const draft = await nylas.getDraft(input.draftId);
  if (!draft.ok) {
    return { ok: false, code: "provider_error", reason: draft.error };
  }

  // Read from the provider, not from the caller: a draft can be edited between
  // composition and approval, and the guard has to see what will actually go.
  const addresses = recipientEmails(draft.data as NylasMessage);
  if (addresses.length === 0) {
    await audit(input, "email.send_blocked", {
      draft_id: input.draftId,
      reason: "recipients_unparsed",
    });
    return {
      ok: false,
      code: "recipients_unparsed",
      reason:
        "Refused: could not confirm this draft's recipients are internal or approved. " +
        "The draft is saved — a human can send it from the mailbox Drafts folder.",
    };
  }

  const identity = await resolveOrgIdentity(input.db, input.orgId);
  const external = addresses.filter((a) => !isInternalTo(identity, a));
  if (external.length > 0) {
    const allowed = await approvedDomains(input.db, input.orgId);
    const notAllowed = external.filter(
      (a) => !allowed.has((a.split("@")[1] ?? "").toLowerCase()),
    );
    if (notAllowed.length > 0) {
      await audit(input, "email.send_blocked", {
        draft_id: input.draftId,
        external,
        not_allowed: notAllowed,
        reason: "domain_not_approved",
      });
      return {
        ok: false,
        code: "domain_not_approved",
        reason:
          `Refused: recipient(s) on a domain that is not approved [${notAllowed.join(", ")}]. ` +
          "Approve the domain in Settings → Agent George → Email domains, or send it by hand " +
          "from the mailbox Drafts folder.",
      };
    }
  }

  const res = await nylas.sendDraft(input.draftId);
  if (!res.ok) {
    return { ok: false, code: "provider_error", reason: res.error };
  }

  await audit(input, "email.sent", {
    draft_id: input.draftId,
    message_id: res.data.id ?? null,
    to: addresses,
    external_approved: external,
    mode: input.mode,
  });

  return { ok: true, messageId: res.data.id ?? null, recipients: addresses };
}
