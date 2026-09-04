/**
 * Getting George to say where an account actually stands.
 *
 * WHY THIS EXISTS
 * `write_account_narrative` was built, registered, reachable and never once
 * called. `customer_narrative` had zero rows, which meant the headline section
 * of every account page — "Where this account stands" — rendered empty on every
 * customer in the book. A tool nothing invokes is the same as a tool that does
 * not exist, and it fails silently, which is worse: the page looked finished.
 *
 * Observations are the raw material and they accumulate on their own. What was
 * missing is the step that reads a pile of them and says what they add up to.
 * Nobody opens an account wanting sixteen bullet points; they want the sentence
 * those bullet points make.
 *
 * WHAT DECIDES WHO GETS ONE
 * Evidence arriving since the last narrative was written. Not a schedule — an
 * account nothing has happened to does not need its story retold, and rewriting
 * it anyway would spend a model call to produce the same paragraph with a newer
 * timestamp. Accounts with no narrative at all come first, because an empty
 * section is worse to look at than a slightly stale one.
 *
 * IT REWRITES, IT DOES NOT APPEND
 * The tool replaces the previous narrative. A summary that grows forever stops
 * being read, and then the account has a long field nobody opens instead of a
 * short one somebody does.
 *
 * IT CANNOT REACH A CUSTOMER
 * `emailSendPolicy: "none"`, and in assistant mode the run holds no
 * `raise_decision` either. This produces one paragraph on one record. That is
 * the whole of it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Per tick. A narrative is a model call; this is not a backfill job. */
const MAX_PER_TICK = 2;

/** Enough new material to be worth re-reading an account that already has one. */
const MIN_NEW_EVIDENCE = 1;

const RUN_BUDGET_MS = 180_000;

export type NarrativeResult = {
  /** Accounts that qualified. */
  candidates: number;
  /** Narrative runs started. */
  written: number;
};

const EMPTY: NarrativeResult = { candidates: 0, written: 0 };

export type NarrativeCandidate = {
  customer_id: string;
  org_id: string;
  name: string;
  new_observations: number;
  new_transcripts: number;
  has_narrative: boolean;
};

/**
 * Find accounts whose story has moved on, and retell it.
 *
 * Never throws: this runs inside the worker tick alongside the useful work, and
 * failing to write a paragraph must not stop the rest of the tick.
 */
export async function sweepNarratives(
  admin: SupabaseClient,
  opts?: { budgetMsRemaining?: number },
): Promise<NarrativeResult> {
  const result: NarrativeResult = { ...EMPTY };

  try {
    // A narrative run is the most expensive thing in the tick. If there is not
    // room for a whole one, do not start one and have the watchdog kill it
    // half-written.
    if ((opts?.budgetMsRemaining ?? RUN_BUDGET_MS) < RUN_BUDGET_MS) return result;

    const rows = await findCandidates(admin);
    result.candidates = rows.length;
    if (!rows.length) return result;

    const { runGeorgeAutonomous } = await import("./run-autonomous");

    for (const row of rows.slice(0, MAX_PER_TICK)) {
      const session = await admin
        .from("agent_sessions")
        .insert({
          org_id: row.org_id,
          // `channel: "cron"` and `user_id: null` are what the other sweeps use
          // and what marks a run as one nobody asked for. There is no `source`
          // column on this table — an earlier version of this insert invented
          // one, and every narrative run failed on it.
          user_id: null,
          channel: "cron",
          title: `Account narrative — ${row.name}`,
          customer_id: row.customer_id,
        })
        .select("id")
        .single();
      if (session.error) {
        console.error("[narrative] could not open a session", row.name, session.error.message);
        continue;
      }

      await runGeorgeAutonomous({
        orgId: row.org_id,
        sessionId: session.data.id as string,
        userPrompt: buildNarrativePrompt(row),
        timeBudgetMs: RUN_BUDGET_MS,
        clientAppTag: "agent-george-narrative/0.1",
        // Nothing this produces leaves the building. One paragraph, one record.
        emailSendPolicy: "none",
      }).catch((err) => {
        console.error("[narrative] run failed", row.name, err);
      });

      result.written += 1;
    }
  } catch (err) {
    console.error("[narrative] sweep failed", err);
  }

  return result;
}

/**
 * Who is due a narrative.
 *
 * Deliberately not clever: a handful of counts per account, for at most fifty
 * accounts, a couple of times an hour. The cost of being obvious here is
 * nothing, and the query this replaces would have needed a migration to add a
 * view that did the same thing less legibly.
 */
export async function findCandidates(admin: SupabaseClient): Promise<NarrativeCandidate[]> {
  const { data: customers } = await admin
    .from("customers")
    .select("id, org_id, name")
    .is("archived_at", null)
    .in("lifecycle", ["onboarding", "active", "at_risk"])
    .limit(50);

  const out: NarrativeCandidate[] = [];

  for (const c of (customers ?? []) as Array<{ id: string; org_id: string; name: string }>) {
    const { data: narr } = await admin
      .from("customer_narrative")
      .select("written_at")
      .eq("customer_id", c.id)
      .order("written_at", { ascending: false })
      .limit(1);
    const since = ((narr ?? [])[0] as { written_at?: string } | undefined)?.written_at;

    // An account with nothing written gets one regardless of how thin the
    // evidence is — George is instructed to say when it is thin, and "quiet
    // since signup" is itself worth reading on the page.
    if (!since) {
      out.push({
        customer_id: c.id,
        org_id: c.org_id,
        name: c.name,
        new_observations: 0,
        new_transcripts: 0,
        has_narrative: false,
      });
      continue;
    }

    const obs = await admin
      .from("customer_observations")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", c.id)
      .gt("created_at", since);

    const tr = await admin
      .from("meeting_transcripts")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", c.id)
      .gt("synced_at", since);

    const newObs = obs.count ?? 0;
    const newTr = tr.count ?? 0;
    if (newObs + newTr >= MIN_NEW_EVIDENCE) {
      out.push({
        customer_id: c.id,
        org_id: c.org_id,
        name: c.name,
        new_observations: newObs,
        new_transcripts: newTr,
        has_narrative: true,
      });
    }
  }

  // Never-written first, then whoever has the most new material.
  return out.sort(
    (a, b) =>
      Number(a.has_narrative) - Number(b.has_narrative) ||
      b.new_observations + b.new_transcripts - (a.new_observations + a.new_transcripts),
  );
}

/**
 * What George is asked.
 *
 * Framed as "read, then say what it adds up to" rather than "summarise". A
 * summary of observations is the observations again at greater length; what the
 * page needs is the judgement they support.
 */
export function buildNarrativePrompt(row: {
  customer_id: string;
  name: string;
  new_observations: number;
  new_transcripts: number;
  has_narrative: boolean;
}): string {
  const situation = row.has_narrative
    ? `There is an existing narrative, and ${row.new_observations} observations and ` +
      `${row.new_transcripts} transcripts have arrived since it was written. Replace it. ` +
      `Say what is true now, not what has changed since last time.`
    : "This account has no narrative yet. This is the first one.";

  return [
    `Write the account narrative for ${row.name} (customer id \`${row.customer_id}\`).`,
    "",
    situation,
    "",
    "# Read before you write",
    "",
    "Use get_customer, list_objectives, and the observations already recorded against",
    "this account. Read the meeting transcripts attached to it if there are any. Do",
    "not write from the customer's name and lifecycle alone — that produces a",
    "paragraph that would be true of any account in the same state, which is the same",
    "as saying nothing.",
    "",
    "# Then write",
    "",
    "Two to five sentences of prose, with write_account_narrative. Lead with where",
    "things actually stand — not the company name, not a restatement of the",
    "lifecycle. Somebody who has never seen this account should finish it knowing",
    "what is going on and what it turns on.",
    "",
    "Cite what you read in `sources`. A narrative is your synthesis, which makes it",
    "the claim a reader is least able to check for themselves; the citations are how",
    "they check it.",
    "",
    "# Say when you do not know",
    "",
    "If the evidence is thin, the narrative should be thin, and should say so. Two",
    "emails and no meetings reads as two emails and no meetings. A confident",
    "paragraph built on nothing is worse than a short one admitting the account is",
    "quiet, because the confident one gets believed.",
    "",
    "Do not write to the customer. Do not raise anything. One paragraph on one record",
    "is the whole task.",
  ].join("\n");
}
