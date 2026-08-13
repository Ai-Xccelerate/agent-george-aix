"use client";

import { useActionState } from "react";
import { updateReviewersAction, type ActionResult } from "./actions";

export function ReviewersForm({ reviewers }: { reviewers: string[] }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    updateReviewersAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-2">
      <input
        name="reviewers"
        defaultValue={reviewers.join(", ")}
        placeholder="nawaz@getonyx.ai, john@getonyx.ai"
        className="h-10 w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400"
      />
      <p className="text-theme-xs text-gray-400 dark:text-gray-500">
        Comma- or space-separated emails. The weekly review digest is addressed to
        these people. They don&apos;t need accounts yet.
      </p>
      {state.error && (
        <div className="rounded-md border border-error-500/30 bg-error-500/10 px-3 py-1.5 text-theme-xs text-error-500">
          {state.error}
        </div>
      )}
      {state.info && (
        <div className="rounded-md border border-success-500/30 bg-success-50 dark:bg-success-500/15 px-3 py-1.5 text-theme-xs text-success-500">
          {state.info}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save reviewers"}
      </button>
    </form>
  );
}
