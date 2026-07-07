"use client";

import { useActionState } from "react";
import type { ActionResult } from "./actions";

type ServerAction = (state: ActionResult, formData: FormData) => Promise<ActionResult>;

export function InviteForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <input
            name="first_name"
            required
            placeholder="Alex"
            className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
        <Field label="Last name">
          <input
            name="last_name"
            required
            placeholder="Patel"
            className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_180px] gap-3">
        <Field label="Work email">
          <input
            type="email"
            name="email"
            required
            placeholder="alex@aixccelerate.com"
            className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
        <Field label="Role">
          <select
            name="role"
            defaultValue="csm"
            className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="admin">Admin</option>
            <option value="csm">CSM</option>
            <option value="sales">Sales</option>
            <option value="viewer">Viewer</option>
          </select>
        </Field>
      </div>

      {state.error && (
        <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-[12px] text-[var(--color-error)]">
          {state.error}
        </div>
      )}
      {state.info && (
        <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success-light)] px-3 py-2 text-[12px] text-[var(--color-success)]">
          {state.info}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
      >
        {pending ? "Sending invite…" : "Send invite"}
      </button>
    </form>
  );
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
