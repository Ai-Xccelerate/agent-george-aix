/**
 * Surfaces that are switched off rather than removed.
 *
 * WHY A FLAG AND NOT A DELETION
 * Same discipline as `integration-toggle.ts` and the `DATABASE_URL` /
 * `STORAGE_DRIVER` switches: a decision that might be revisited is a flag, and a
 * decision that has been made is a deletion. These are the former. The code
 * behind each one stays compiled, typechecked and tested — flipping the
 * constant is the whole of turning it back on, with no archaeology.
 *
 * WHAT "OFF" HAS TO MEAN
 * Unreachable, not discouraged. `integration-toggle.ts` records what happens
 * otherwise: on 20 August `send_email_draft` was registered while a prompt said
 * not to use it, three other sources agreed with the prompt, and George sent 16
 * emails anyway. So off here means the route 404s and the nav entry, the command
 * palette entry and every in-app link to it are gone. A live link into a dead
 * surface is the same failure in a smaller costume.
 */

/**
 * The cross-book AI-actions queue (`/actions`).
 *
 * OFF since 2026-09-04, on Rahul's call: a queue of things George raised
 * becomes overwhelming for AIX and for customers alike. The evidence was
 * already in the data — one broken mailbox produced 34 open escalations, and a
 * queue where most rows are George thinking out loud is a queue nobody reads,
 * so the one row that mattered is missed too.
 *
 * What replaces it is not a smaller queue. George records what he notices on
 * the customer record (`customer_observations`, migration 0008) where a person
 * reads the account and decides; the few things that genuinely need an answer
 * appear on that account, addressed to a named approver. Nothing accumulates
 * centrally waiting to be worked through.
 *
 * The escalation machinery is untouched and still writes rows — this switches
 * off the surface that turned them into a worklist, not the ability to raise
 * one. `/customers/[id]` renders the open ones for that account.
 */
export const AI_ACTIONS_QUEUE_ENABLED = false;

/**
 * Whether George's `send_email_draft` tool is registered at all.
 *
 * OFF: the send path stays built, guarded and tested — `send-guarded.ts`, its
 * allowlist, its volume ceiling and their tests all still run — and George
 * cannot reach it. Keeping the path intact matters because the guards are the
 * expensive part and they rot if they stop being exercised; keeping it
 * unreachable matters because a capability present with prose saying "don't" is
 * not a control.
 *
 * Turning this back on registers the tool and the existing guards apply
 * unchanged. See `nylas-tools.ts` for the registration site.
 */
export const EMAIL_SENDING_EXPOSED = false;
