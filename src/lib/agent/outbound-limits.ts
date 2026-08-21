/**
 * Volume limits on what George does unprompted.
 *
 * WHY THIS EXISTS — 2026-08-20
 * A tenancy bug in a background sweep mirrored one organisation's meetings into
 * every organisation and queued 1,016 TRANSCRIPT_READY events. When the cron
 * lock that had been hiding that queue was released, George worked through it
 * and sent 16 meeting recaps to 14 colleagues in 90 minutes.
 *
 * Every one of those sends was authorised. The recipients were internal, the
 * outbound domain guard was armed and had nothing to refuse, and each send had
 * a draft and an audit row. Nothing in the email layer malfunctioned.
 *
 * That is the point. The safety rules were about *who* George may write to, and
 * they held. There was nothing about *how much* George may do, or *how old* a
 * task may be before acting on it is absurd — and those are the two dimensions
 * this incident actually ran along. Tightening the recipient rules would have
 * prevented none of it.
 *
 * So these limits are deliberately about volume and staleness, and they are
 * blunt on purpose: a cap that occasionally annoys a human is a far better
 * failure than an agent that empties a thousand-item queue into people's inboxes
 * before anyone notices.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sends per hour, per org, when George is acting on its own — inbound mail,
 * cron, transcript events.
 *
 * Three is chosen against the incident: George legitimately wanted to send 16
 * in 90 minutes, so any cap in single digits converts this from an event into a
 * curiosity someone notices in the log. Real unprompted work (a reply to an
 * internal thread, an escalation) is a trickle, not a burst; if this limit is
 * ever hit in normal operation, something upstream has gone wrong and stopping
 * is the correct response.
 */
export const AUTONOMOUS_SENDS_PER_HOUR = 3;

/**
 * Sends per hour, per org, when a human is driving the conversation.
 *
 * Higher because each one is a person clicking send in chat, so the human is
 * the rate limit. This is only a backstop against a loop inside a single
 * session, not a policy on how much mail a team may send.
 */
export const CHAT_SENDS_PER_HOUR = 15;

/**
 * DELIBERATELY NOT HERE: an event-age limit.
 *
 * The first attempt at this gated on how old the agent_event was, which is
 * useless — a backfill mints brand-new events for years-old meetings, so every
 * one of the 16 recaps would have passed. Staleness has to be judged on the
 * underlying thing's own date (when the meeting ended, when the mail arrived) at
 * the moment work is CREATED. See transcript-sync.ts and mailbox-sync.ts.
 */

export type SendRateVerdict = {
  allowed: boolean;
  /** Sends already made in the window. */
  sent: number;
  cap: number;
  mode: "autonomous" | "chat";
};

/**
 * How many emails this org has sent in the last hour, and whether one more is
 * allowed.
 *
 * Counts `email.sent` audit rows rather than tracking state of its own, so it
 * cannot drift from what actually happened and needs no migration. The audit
 * row is written on every successful send by both mail providers.
 *
 * FAILS CLOSED. If the count cannot be read we refuse the send: a database
 * hiccup must not be a way to bypass the cap, because the whole point is to
 * bound the blast radius of a situation nobody is watching.
 */
export async function checkSendRate(
  db: SupabaseClient,
  orgId: string,
  mode: "autonomous" | "chat",
): Promise<SendRateVerdict> {
  const cap = mode === "autonomous" ? AUTONOMOUS_SENDS_PER_HOUR : CHAT_SENDS_PER_HOUR;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error } = await db
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("action", "email.sent")
    .gte("created_at", since);

  if (error) {
    // Cannot prove we are under the cap, so we are not under the cap.
    return { allowed: false, sent: -1, cap, mode };
  }

  const sent = count ?? 0;
  return { allowed: sent < cap, sent, cap, mode };
}

/** Human-readable refusal, used verbatim by both providers' send tools. */
export function sendRateMessage(v: SendRateVerdict): string {
  if (v.sent < 0) {
    return (
      "Refused to send: couldn't check how many emails have already gone out this hour, " +
      "so the send limit can't be confirmed. The draft is saved — a human can send it " +
      "from the mailbox Drafts folder."
    );
  }
  const who = v.mode === "autonomous" ? "unprompted" : "this session";
  return (
    `Refused to send: ${v.sent} email${v.sent === 1 ? "" : "s"} have already been sent ${who} ` +
    `in the last hour, which is the limit (${v.cap}). The draft is saved and nothing was lost — ` +
    `a human can send it from the mailbox Drafts folder. If a burst of mail is genuinely ` +
    `expected, raise the limit deliberately rather than working around it.`
  );
}


