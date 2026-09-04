"use client";

/**
 * The full editor for George's unprompted contacts — add, remove, retime, and
 * change what each one asks for.
 *
 * WHY ROWS ARE CLIENT STATE AND SUBMISSION IS INDEXED FORM FIELDS
 * Adding and removing rows has to happen before the save, so the list is React
 * state; the fields are then named `key:<i>` / `day:<i>` / ... and a `count`
 * tells the action how far to look. Removing a row simply drops it, which
 * leaves a gap in the indexes — the action treats a missing `key:<i>` as a
 * removed row rather than an error, so no renumbering is needed and no row can
 * be lost to an off-by-one.
 *
 * WHY THE TIMELINE IS RENDERED FROM THE ROWS BEING EDITED
 * "Two emails in the first week" is the sentence Rahul asked to be able to
 * check, and it is not readable off four number inputs. The strip recomputes as
 * you type, so what you are about to save is stated in the same terms the
 * question was asked in — before you save it, not after.
 */

import { useActionState, useMemo, useState } from "react";
import { CalendarClock, Plus, Save, Trash2 } from "lucide-react";
import type { ActionResult } from "@/lib/actions";

export type TouchpointRow = {
  key: string;
  day_offset: number;
  purpose: string;
  ask: string;
};

/** A stable react key that survives editing the business key. */
type Editable = TouchpointRow & { uid: string };

let uidSeq = 0;
const nextUid = () => `row-${uidSeq++}`;

export function TouchpointsForm({
  action,
  initial,
  silenceDays,
  silenceEscalateAfter,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  initial: TouchpointRow[];
  silenceDays: number;
  silenceEscalateAfter: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [rows, setRows] = useState<Editable[]>(() =>
    initial.map((t) => ({ ...t, uid: nextUid() })),
  );

  const update = (uid: string, patch: Partial<TouchpointRow>) =>
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  const remove = (uid: string) => setRows((rs) => rs.filter((r) => r.uid !== uid));

  const add = () =>
    setRows((rs) => [
      ...rs,
      {
        uid: nextUid(),
        key: "",
        // One week past the current last contact — a guess that is usually
        // roughly right and always visible, rather than another day 0.
        day_offset: rs.length ? Math.max(...rs.map((r) => r.day_offset)) + 7 : 0,
        purpose: "",
        ask: "",
      },
    ]);

  // The sentence the schedule adds up to. Recomputed as you type.
  const summary = useMemo(() => describeSchedule(rows), [rows]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="count" value={rows.length} />

      {/* What this schedule means, in the terms the question gets asked in. */}
      <div className="rounded-lg border border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 p-3">
        <div className="flex items-start gap-2">
          <CalendarClock size={15} className="mt-0.5 shrink-0 text-brand-500 dark:text-brand-400" />
          <div>
            <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
              {summary.headline}
            </div>
            {summary.detail && (
              <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                {summary.detail}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <div
            key={r.uid}
            className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02] p-3"
          >
            <div className="flex flex-wrap items-start gap-3">
              <label className="flex-1 min-w-[180px] text-theme-xs text-gray-500 dark:text-gray-400">
                <span className="mb-1 block">Name</span>
                <input
                  name={`key:${i}`}
                  value={r.key}
                  onChange={(e) => update(r.uid, { key: e.target.value })}
                  placeholder="week_one_check_in"
                  className="h-9 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2 font-mono text-theme-xs text-gray-800 dark:text-white/90 focus:border-brand-500 focus:outline-none"
                />
              </label>

              <label className="w-28 text-theme-xs text-gray-500 dark:text-gray-400">
                <span className="mb-1 block">Day</span>
                <input
                  type="number"
                  name={`day:${i}`}
                  value={r.day_offset}
                  onChange={(e) =>
                    update(r.uid, { day_offset: Number(e.target.value) || 0 })
                  }
                  min={0}
                  max={365}
                  className="h-9 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2 text-theme-sm tabular-nums text-gray-800 dark:text-white/90 focus:border-brand-500 focus:outline-none"
                />
              </label>

              <button
                type="button"
                onClick={() => remove(r.uid)}
                aria-label={`Remove ${r.key || "this contact"}`}
                className="mt-5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-2 text-gray-400 dark:text-gray-500 transition-colors hover:border-error-500/40 hover:text-error-500"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-theme-xs text-gray-500 dark:text-gray-400">
                <span className="mb-1 block">What it is for</span>
                <textarea
                  name={`purpose:${i}`}
                  value={r.purpose}
                  onChange={(e) => update(r.uid, { purpose: e.target.value })}
                  rows={2}
                  placeholder="Confirm the kickoff landed and surface anything blocking setup."
                  className="w-full resize-y rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2 py-1.5 text-theme-xs leading-relaxed text-gray-800 dark:text-white/90 focus:border-brand-500 focus:outline-none"
                />
              </label>
              <label className="text-theme-xs text-gray-500 dark:text-gray-400">
                <span className="mb-1 block">What it asks for</span>
                <textarea
                  name={`ask:${i}`}
                  value={r.ask}
                  onChange={(e) => update(r.uid, { ask: e.target.value })}
                  rows={2}
                  placeholder="One ask only — e.g. confirm who owns the data import."
                  className="w-full resize-y rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2 py-1.5 text-theme-xs leading-relaxed text-gray-800 dark:text-white/90 focus:border-brand-500 focus:outline-none"
                />
              </label>
            </div>
          </div>
        ))}

        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-warning-500/40 bg-warning-50 dark:bg-warning-500/10 p-3 text-theme-xs leading-relaxed text-warning-600 dark:text-warning-400">
            No contacts. Saving an empty schedule is refused — it would make George
            refuse to onboard rather than stay quiet, and you would find out from a
            failed onboarding. To stop George writing first, change the operating
            model to assistant mode instead.
          </p>
        )}

        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 py-2 text-theme-sm font-medium text-gray-800 dark:text-white/90 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.06]"
        >
          <Plus size={14} />
          Add a contact
        </button>
      </div>

      {/* Silence is the other half of "may George write unprompted": one half
          is the planned schedule, the other is what he does when nobody
          answers it. Splitting them across two screens would leave the
          question half-answered on each. */}
      <div className="space-y-3 rounded-lg border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02] p-3">
        <h3 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
          When nobody replies
        </h3>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-theme-xs text-gray-500 dark:text-gray-400">
            <span className="mb-1 block">Silence counts after</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                name="silence_days"
                defaultValue={silenceDays}
                min={1}
                max={90}
                className="h-9 w-20 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2 text-theme-sm tabular-nums text-gray-800 dark:text-white/90 focus:border-brand-500 focus:outline-none"
              />
              days without a reply
            </span>
          </label>
          <label className="text-theme-xs text-gray-500 dark:text-gray-400">
            <span className="mb-1 block">Raise a decision after</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                name="silence_escalate_after"
                defaultValue={silenceEscalateAfter}
                min={1}
                max={10}
                className="h-9 w-20 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2 text-theme-sm tabular-nums text-gray-800 dark:text-white/90 focus:border-brand-500 focus:outline-none"
              />
              unanswered contacts
            </span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-3.5 py-2 text-theme-sm font-medium text-white transition hover:bg-brand-600 disabled:bg-brand-300"
        >
          <Save size={14} />
          {pending ? "Saving…" : "Save schedule"}
        </button>
        {state.error && <span className="text-theme-xs text-error-500">{state.error}</span>}
        {state.info && (
          <span className="text-theme-xs text-success-600 dark:text-success-500">
            {state.info}
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * The schedule as a sentence.
 *
 * The first week is called out on its own because that is the window the
 * question was asked about — "signup → two emails in the first week" — and it
 * is the window where getting it wrong is most noticeable to a customer.
 */
function describeSchedule(rows: TouchpointRow[]): { headline: string; detail: string | null } {
  if (rows.length === 0) {
    return {
      headline: "George would never write first.",
      detail: null,
    };
  }

  const days = rows.map((r) => r.day_offset).sort((a, b) => a - b);
  const firstWeek = days.filter((d) => d <= 7).length;
  const n = rows.length;

  const headline =
    firstWeek > 0
      ? `From signup: ${firstWeek} email${firstWeek === 1 ? "" : "s"} in the first week, ${n} in total.`
      : `From signup: ${n} email${n === 1 ? "" : "s"}, none in the first week.`;

  const unnamed = rows.filter((r) => !r.key.trim()).length;
  const detail = [
    `Days ${days.join(", ")} after onboarding starts.`,
    unnamed > 0
      ? `${unnamed} contact${unnamed === 1 ? "" : "s"} still needs a name before this can be saved.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return { headline, detail: detail || null };
}
