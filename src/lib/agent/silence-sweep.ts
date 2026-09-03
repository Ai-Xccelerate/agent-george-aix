/**
 * Noticing that nobody answered.
 *
 * WHY SILENCE IS THE SIGNAL WORTH BUILDING FOR
 * Most customers who leave never complain. They go quiet, and quiet does not
 * arrive in anyone's inbox — there is no event, no ticket, no notification.
 * Every other health signal in this system is triggered by something happening;
 * this one is triggered by something failing to.
 *
 * A day-0 silence is also the earliest bad signal available. Waiting for a
 * renewal conversation to discover the account never got started is discovering
 * it eleven months late.
 *
 * WHAT IT DOES AND DOES NOT DO
 * It records a health signal per silent touchpoint, and raises a decision once
 * the tenant's threshold of consecutive silent contacts is crossed. It does not
 * write to the customer. Deciding to chase somebody who has ignored two emails
 * is a judgement about a relationship, and it belongs to a person.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTenantProcess } from "./tenant-process";

const DAY_MS = 86_400_000;

/** Per tick. Silence is not urgent — it is days old by definition. */
const MAX_PER_TICK = 25;

export type SilenceResult = {
  /** Touchpoints newly marked silent. */
  marked: number;
  /** Health checks written. */
  health: number;
  /** Decisions raised. */
  escalated: number;
};

const EMPTY: SilenceResult = { marked: 0, health: 0, escalated: 0 };

type Row = {
  id: string;
  org_id: string;
  customer_id: string;
  plan_id: string;
  touchpoint_key: string;
  sent_at: string;
  recipient_email: string | null;
};

/**
 * Find sends nobody answered, and say so.
 *
 * Never throws: this runs inside the worker tick alongside the useful work, and
 * a failure to notice silence must not stop the rest of the tick.
 */
export async function sweepSilence(admin: SupabaseClient): Promise<SilenceResult> {
  const result: SilenceResult = { ...EMPTY };

  try {
    // Widest possible window first, then narrowed per org: silence_days is a
    // tenant setting, so a single global cutoff would either miss the tenants
    // with a short window or fire early for the ones with a long one.
    const { data } = await admin
      .from("onboarding_touchpoint")
      .select(
        "id, org_id, customer_id, plan_id, touchpoint_key, sent_at, recipient_email, " +
          // Archived customers are off the book, and raising a decision about
          // one is asking a person to act on an account somebody already
          // removed. `!inner` so the touchpoint drops with the customer.
          "customers!inner(archived_at)",
      )
      .is("customers.archived_at", null)
      .eq("status", "sent")
      .is("replied_at", null)
      .is("silence_escalated_at", null)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: true })
      .limit(MAX_PER_TICK * 4);

    const rows = (data ?? []) as unknown as Row[];
    if (!rows.length) return result;

    const byOrg = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byOrg.get(r.org_id) ?? [];
      list.push(r);
      byOrg.set(r.org_id, list);
    }

    let budget = MAX_PER_TICK;

    for (const [orgId, orgRows] of byOrg) {
      if (budget <= 0) break;

      // A tenant with no usable process gets no sweep. The window and the
      // threshold are both theirs to set, and guessing them is the same
      // invention the resolver refuses everywhere else.
      const process = await resolveTenantProcess(admin, orgId).catch(() => null);
      if (!process) continue;

      const windowMs = process.escalation.silence_days * DAY_MS;
      const threshold = process.escalation.silence_escalate_after;
      const cutoff = Date.now() - windowMs;

      for (const row of orgRows) {
        if (budget <= 0) break;
        const sentAt = Date.parse(row.sent_at);
        if (!Number.isFinite(sentAt) || sentAt > cutoff) continue;
        budget -= 1;

        const days = Math.floor((Date.now() - sentAt) / DAY_MS);

        await admin
          .from("onboarding_touchpoint")
          .update({
            status: "silent",
            silence_escalated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          // Guarded so two overlapping ticks cannot both act on the same row.
          .is("silence_escalated_at", null);
        result.marked += 1;

        // A health signal per silent touchpoint. Yellow rather than red: one
        // unanswered email is a person who is busy at least as often as it is
        // an account in trouble, and crying red at the first one makes the
        // band meaningless by the time it matters.
        await admin.from("customer_health").insert({
          customer_id: row.customer_id,
          band: "yellow",
          reason:
            `No reply to the "${row.touchpoint_key}" onboarding email after ${days} days` +
            (row.recipient_email ? ` (sent to ${row.recipient_email})` : "") + ".",
          measured_at: new Date().toISOString(),
        });
        result.health += 1;

        // How many consecutive contacts has this account now ignored?
        const { count } = await admin
          .from("onboarding_touchpoint")
          .select("id", { count: "exact", head: true })
          .eq("plan_id", row.plan_id)
          .eq("status", "silent");
        const silentCount = count ?? 1;

        if (silentCount < threshold) continue;

        // Once per plan, not once per touchpoint. Somebody who has ignored
        // three emails does not need three identical decisions about it.
        //
        // Keyed on the plan rather than matched on the title. The `ilike
        // '%has gone quiet%'` this replaces worked only for as long as nobody
        // edited the sentence — and the sentence is copy, so somebody would
        // have. A dedupe key names the condition instead of describing it.
        const dedupeKey = `onboarding_silence:${row.plan_id}`;
        const { data: existing } = await admin
          .from("escalations")
          .select("id")
          .eq("org_id", orgId)
          .eq("status", "open")
          .eq("dedupe_key", dedupeKey)
          .limit(1);
        if ((existing ?? []).length) continue;

        const { data: cust } = await admin
          .from("customers")
          .select("name")
          .eq("id", row.customer_id)
          .maybeSingle();
        const name = (cust?.name as string | undefined) ?? "This customer";

        await admin.from("escalations").insert({
          org_id: orgId,
          customer_id: row.customer_id,
          title: `${name} has gone quiet during onboarding`,
          detail:
            `${silentCount} onboarding emails have gone unanswered, the most recent being ` +
            `"${row.touchpoint_key}" ${days} days ago` +
            (row.recipient_email ? `, sent to ${row.recipient_email}` : "") +
            `. Most customers who disengage never say so, which is why this is worth ` +
            `looking at now rather than at renewal.`,
          recommendation:
            "Decide whether to chase, change who is being written to, or pause onboarding " +
            "and talk to whoever owns the relationship. George will not chase again on his " +
            "own — continuing to email someone who is not answering is the thing that turns " +
            "quiet into ignored.",
          urgency: "normal",
          status: "open",
          // A judgement about a relationship — whether to chase, change who is
          // being written to, or stop. That is an account decision, not a fault.
          kind: "account",
          dedupe_key: dedupeKey,
        });
        result.escalated += 1;
      }
    }
  } catch (err) {
    console.error("[silence] sweep failed", err);
  }

  return result;
}
