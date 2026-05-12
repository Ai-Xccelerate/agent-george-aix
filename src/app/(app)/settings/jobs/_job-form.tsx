"use client";

import { useActionState } from "react";
import type { ActionResult } from "./actions";

type ServerAction = (state: ActionResult, formData: FormData) => Promise<ActionResult>;

export function NewJobForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3" key={state.info ?? "new"}>
      <Field label="Job name">
        <input
          name="name"
          required
          placeholder="Morning utilization sweep"
          className={inputClass}
        />
      </Field>

      <Field label="Directive">
        <textarea
          name="directive"
          required
          rows={4}
          placeholder="Every morning, pull yesterday's utilization deltas for each active customer. Flag any account that dropped more than 20% week-over-week and draft a check-in email to the partner admin."
          className={`${inputClass} h-auto py-2`}
        />
        <span className="mt-1 block text-[11px] text-[var(--color-fg-muted)]">
          Tell George what to do in plain English — the same way you'd describe
          a task in chat.
        </span>
      </Field>

      <div className="grid grid-cols-[1fr_220px] gap-3">
        <Field label="Cron schedule">
          <input
            name="cron"
            required
            defaultValue="0 9 * * 1-5"
            placeholder="0 9 * * 1-5"
            className={`${inputClass} font-mono`}
          />
          <span className="mt-1 block text-[11px] text-[var(--color-fg-muted)]">
            5-field cron. Example: <code>0 9 * * 1-5</code> = 9am weekdays.
          </span>
        </Field>
        <Field label="Timezone (optional)">
          <input
            name="timezone"
            placeholder="America/Los_Angeles"
            className={inputClass}
          />
          <span className="mt-1 block text-[11px] text-[var(--color-fg-muted)]">
            Falls back to the org default.
          </span>
        </Field>
      </div>

      <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-[var(--color-fg)]">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked
          className="accent-[var(--color-accent)]"
        />
        Enable immediately
      </label>

      <Status state={state} />

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Creating…" : "Create job"}
      </button>
    </form>
  );
}

function Status({ state }: { state: ActionResult }) {
  if (state.error) {
    return (
      <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-[12px] text-[var(--color-error)]">
        {state.error}
      </div>
    );
  }
  if (state.info) {
    return (
      <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success-light)] px-3 py-2 text-[12px] text-[var(--color-success)]">
        {state.info}
      </div>
    );
  }
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[var(--color-fg-secondary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]";

const submitClass =
  "inline-flex h-10 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60";
