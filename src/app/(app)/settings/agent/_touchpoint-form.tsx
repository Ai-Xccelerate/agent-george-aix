"use client";

/**
 * Touchpoint frequency — when George reaches out, and how long silence runs
 * before it counts as a signal.
 *
 * Only the timing is editable here. The purpose and the ask of each touchpoint
 * are what George writes from, and changing those is a different kind of
 * decision than changing a cadence — one is "reach out sooner", the other is
 * "say something else". Editing prose that becomes customer email deserves its
 * own screen with its own review, not a row of number inputs.
 */
import { useActionState } from "react";
import { CalendarClock, Save } from "lucide-react";

export type TouchpointRow = { key: string; day_offset: number; purpose: string; ask: string };

export type TouchpointFormState = { ok: boolean; message: string } | null;

export function TouchpointForm({
  action,
  touchpoints,
  silenceDays,
  silenceEscalateAfter,
}: {
  action: (state: TouchpointFormState, formData: FormData) => Promise<TouchpointFormState>;
  touchpoints: TouchpointRow[];
  silenceDays: number;
  silenceEscalateAfter: number;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-left">
          <thead className="bg-gray-50 dark:bg-white/[0.03]">
            <tr>
              <th className="px-3 py-2 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                Contact
              </th>
              <th className="px-3 py-2 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                Day
              </th>
              <th className="px-3 py-2 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                What it is for
              </th>
            </tr>
          </thead>
          <tbody>
            {touchpoints.map((t) => (
              <tr key={t.key} className="border-t border-gray-200 dark:border-gray-800">
                <td className="px-3 py-2.5 text-theme-sm font-medium text-gray-800 dark:text-white/90">
                  {t.key.replace(/_/g, " ")}
                </td>
                <td className="px-3 py-2.5">
                  <input
                    type="number"
                    name={`day:${t.key}`}
                    defaultValue={t.day_offset}
                    min={0}
                    max={365}
                    className="h-9 w-20 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2 text-theme-sm tabular-nums text-gray-800 dark:text-white/90 focus:border-brand-500 focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2.5 text-theme-xs text-gray-500 dark:text-gray-400">
                  {t.purpose}
                  <span className="mt-0.5 block text-gray-400 dark:text-gray-500">
                    Asks: {t.ask}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3">
        <CalendarClock size={16} className="mb-2 shrink-0 text-gray-400 dark:text-gray-500" />
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

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-3.5 py-2 text-theme-sm font-medium text-white transition hover:bg-brand-600 disabled:bg-brand-300"
        >
          <Save size={14} />
          {pending ? "Saving…" : "Save cadence"}
        </button>
        {state && (
          <span
            className={`text-theme-xs ${state.ok ? "text-success-600 dark:text-success-500" : "text-error-500"}`}
          >
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
