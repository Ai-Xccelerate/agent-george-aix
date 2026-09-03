/**
 * What George is allowed to initiate on his own.
 *
 * WHY THIS FILE EXISTS
 * `agent_settings.operating_mode` has been `assistant | operator` for months.
 * It has a settings UI, it is stored per org, and until now it was enforced in
 * exactly one place: a sentence in the system prompt telling George to ask
 * first. That is the same shape as an agent holding `send_email_draft` while
 * being instructed not to use it — a restraint that lives in advice rather than
 * in what the code will do. Prompts are advisory.
 *
 * So the mode now decides, mechanically, what an autonomous run may produce.
 *
 * WHAT ASSISTANT MODE STOPS, AND WHAT IT DOES NOT
 * It stops George creating work for a human: no escalations from autonomous
 * paths. It does not stop him looking. Reading email, ingesting transcripts,
 * assessing onboarding state, recording health — all of that continues, because
 * the point of the mode is to change what he does with what he notices, not to
 * make him stop noticing.
 *
 * In place of an escalation he records an observation: something noticed,
 * attached to the account, that nobody has to action. A person reads the
 * account and decides whether any of it deserves doing something about.
 *
 * WHY NOT JUST DELETE THE SCANS
 * Because the scans are the observing. Switching them off would deliver
 * "George stops filling my queue" by also delivering "George stops learning
 * anything", which is the opposite of the ask.
 *
 * A HUMAN ASKING IS ALWAYS ALLOWED
 * This gate governs autonomous runs only. When somebody types "draft that email
 * and send it to me", that is a chat run and it keeps the full grant — the
 * request IS the authorisation, which is the whole idea of request-based.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgentSettings, type OperatingMode } from "./agent-settings";

/** Cached briefly: the tick reads this once per org per pass. */
const TTL_MS = 60_000;
const cache = new Map<string, { mode: OperatingMode; at: number }>();

export function clearOperatingModeCache(): void {
  cache.clear();
}

/**
 * The org's mode, defaulting to `assistant`.
 *
 * Fails to `assistant` on any error. The permissive default would be the one
 * that emails customers and fills queues when the settings lookup breaks, and
 * a lookup failure is not consent.
 */
export async function resolveOperatingMode(
  db: SupabaseClient,
  orgId: string,
): Promise<OperatingMode> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.mode;

  let mode: OperatingMode = "assistant";
  try {
    mode = (await getAgentSettings(db, orgId)).operating_mode ?? "assistant";
  } catch {
    return "assistant"; // not cached — a transient failure should not stick
  }
  cache.set(orgId, { mode, at: Date.now() });
  return mode;
}

/**
 * May an autonomous run in this org create work for a human?
 *
 * `operator` yes, `assistant` no. Named for what it decides rather than for the
 * mode, so call sites read as the question they are actually asking.
 */
export async function mayRaiseDecisionsAutonomously(
  db: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  return (await resolveOperatingMode(db, orgId)) === "operator";
}

/**
 * The line George reads about it.
 *
 * Kept next to the mechanism deliberately. When these two drift, the prompt is
 * the one that lies — so they are edited together or not at all.
 */
export function renderAutonomyBlock(mode: OperatingMode): string {
  if (mode === "operator") {
    return [
      "# What you may start on your own",
      "",
      "This organisation runs you in operator mode. You may raise a decision when",
      "something genuinely needs a person, and you should — but the bar is that a",
      "human could act on it today. Thinking out loud onto the queue is not a",
      "decision.",
    ].join("\n");
  }

  return [
    "# What you may start on your own: nothing that asks a person to act",
    "",
    "This organisation runs you in assistant mode. On a run nobody asked for, you",
    "observe and record. You do not raise decisions and you do not write to",
    "customers.",
    "",
    "Use `record_observation` for anything you notice — a risk, a commitment they",
    "made, a change in tone, a milestone that slipped. One line somebody can scan,",
    "with the evidence underneath, and quote the customer where there is a quote to",
    "give. Several observations about one account is normal; that is what building a",
    "picture looks like.",
    "",
    "`raise_decision` is not available to you on this run. That is deliberate and it",
    "is not a problem to work around: if something looks urgent, record it as an",
    "observation and say plainly in the summary that you think it needs attention.",
    "A person reads these.",
    "",
    "When somebody asks you directly for something — in chat, in a request — that is",
    "different. The asking is the authorisation, and you do what was asked.",
  ].join("\n");
}
