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
        className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
      />
      <p className="text-[11px] text-[var(--color-fg-muted)]">
        Comma- or space-separated emails. The weekly review digest is addressed to
        these people. They don&apos;t need accounts yet.
      </p>
      {state.error && (
        <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-1.5 text-[12px] text-[var(--color-error)]">
          {state.error}
        </div>
      )}
      {state.info && (
        <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success-light)] px-3 py-1.5 text-[12px] text-[var(--color-success)]">
          {state.info}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center rounded-md bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save reviewers"}
      </button>
    </form>
  );
}
