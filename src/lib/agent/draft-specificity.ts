/**
 * Does this email say anything true only of this account?
 *
 * WHY THIS EXISTS AS CODE RATHER THAN AS A PROMPT RULE
 * The composer prompt has two jobs that pull against each other: hide the
 * internal vocabulary, and keep the customer's own facts. Every time the first
 * rule gets tightened, the second one loses ground — the model reads a longer
 * list of things not to mention and generalises it into saying nothing
 * particular at all. That is exactly what happened: an anti-leak rule that
 * listed "day numbers" and "first-value definitions" produced emails that could
 * have been sent to any customer on the book.
 *
 * A prompt rule cannot guard against its own future tightening, because the
 * tightening is a prompt edit too. This check is the part that survives it: if
 * the composer stops writing account-specific emails, drafts start arriving at
 * the approval screen flagged, and somebody sees it.
 *
 * IT FLAGS, IT DOES NOT BLOCK
 * A generic email is a quality problem, not a safety one. Every draft on this
 * path is already approval-gated, so the useful thing is to tell the reviewer
 * what is missing — not to refuse to produce it and leave them with nothing.
 *
 * IT IS DELIBERATELY STRICT
 * A false "not specific" is a nudge on a screen a human is already reading. A
 * false "specific" is the check quietly passing everything, which is the same
 * as not having it. Where the two are in tension, this errs towards flagging.
 */

/** Facts the account owns, in the form the check can look for. */
export type SpecificityFacts = {
  /** ISO dates from the contract, plan, and dated objectives. */
  dates: Array<string | null | undefined>;
  /**
   * Blocker titles, first-value labels, and anything the customer said they
   * would do. Matched on distinctive words, not whole strings — George will
   * paraphrase, and should.
   */
  terms: Array<string | null | undefined>;
};

export type SpecificityResult = {
  ok: boolean;
  /** What made it specific, in words a reviewer can read. */
  found: string[];
};

/**
 * Words that are common enough, or generic enough to onboarding, that finding
 * one proves nothing. "Please confirm your account setup" contains four of them
 * and is the exact email this check exists to catch.
 */
const GENERIC = new Set([
  "about", "after", "again", "against", "already", "another", "anything", "around",
  "because", "been", "before", "being", "below", "between", "both", "could", "does",
  "doing", "during", "each", "either", "every", "from", "further", "have", "having",
  "here", "html", "into", "just", "more", "most", "much", "need", "needs", "once",
  "only", "other", "over", "same", "should", "since", "some", "such", "than", "that",
  "their", "them", "then", "there", "these", "they", "thing", "things", "this",
  "those", "through", "under", "until", "very", "were", "what", "when", "where",
  "which", "while", "will", "with", "would", "your", "yours",
  // Generic to this domain: true of every onboarding email ever sent.
  "access", "account", "accounts", "agent", "call", "check", "client", "company",
  "confirm", "confirmed", "customer", "email", "george", "hello", "kick", "kickoff",
  "meeting", "onboarding", "please", "process", "project", "quick", "ready",
  "regards", "reply", "setup", "start", "started", "step", "steps", "team", "thanks",
  "touch", "update", "week", "welcome",
]);

/** Month names and the three-letter abbreviations, for date detection. */
const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december" +
  "|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

/**
 * A date a reader could put in a calendar. Deliberately excludes bare weekdays:
 * "by Friday" is a nudge, "by Friday 12 September" is a commitment, and only the
 * second one is still unambiguous when the email is read on Monday.
 */
const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/,
  new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTHS})\b`, "i"),
  new RegExp(String.raw`\b(?:${MONTHS})\s+\d{1,2}(?:st|nd|rd|th)?\b`, "i"),
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
];

/** Drafts are HTML. Tags and entities are not content and must not match. */
function toText(body: string): string {
  return body
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words in a fact that are worth looking for. */
function distinctiveWords(term: string): string[] {
  return (term.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? []).filter(
    (w) => !GENERIC.has(w.replace(/[^a-z]/g, "")),
  );
}

/** The surface forms an ISO date can take once a person writes it down. */
function dateSurfaceForms(iso: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return [];
  const [, y, mo, d] = m;
  const monthIdx = Number(mo) - 1;
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const name = names[monthIdx];
  if (!name) return [];
  const day = String(Number(d));
  return [`${y}-${mo}-${d}`, `${day} ${name}`, `${name} ${day}`, `${day} ${name.slice(0, 3)}`];
}

/**
 * Is there at least one thing in here that is true only of this account?
 *
 * Three ways to pass, matching the three kinds of concrete detail a person
 * recognises: a date, a named blocker or milestone, or a commitment the customer
 * made in their own words.
 */
export function checkDraftSpecificity(
  body: string,
  facts: SpecificityFacts,
): SpecificityResult {
  const text = toText(body ?? "");
  if (!text) return { ok: false, found: [] };

  const lower = text.toLowerCase();
  const found: string[] = [];

  // 1. A date the account owns, named as such so the reviewer sees which one.
  for (const iso of facts.dates) {
    if (!iso) continue;
    const hit = dateSurfaceForms(iso).find((f) => lower.includes(f.toLowerCase()));
    if (hit) found.push(`account date ${iso} ("${hit}")`);
  }

  // 2. Any other calendar date. A date George proposed is still a commitment
  //    the recipient can act on, even though it is not in the account record.
  if (!found.length) {
    for (const re of DATE_PATTERNS) {
      const m = re.exec(text);
      if (m) {
        found.push(`a calendar date ("${m[0]}")`);
        break;
      }
    }
  }

  // 3. A named blocker, milestone, or commitment.
  for (const term of facts.terms) {
    if (!term) continue;
    const hit = distinctiveWords(term).find((w) => lower.includes(w));
    if (hit) found.push(`"${term}" (matched on "${hit}")`);
  }

  return { ok: found.length > 0, found };
}
